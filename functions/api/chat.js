export async function onRequestPost(context) {
  const { request, env } = context;
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  try {
    const { message, history } = await request.json();
    const apiKey = env.GEMINI_API_KEY;

    if (!apiKey) {
      return new Response(JSON.stringify({ error: "مفتاح الـ GEMINI_API_KEY مفقود!" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const fileNames = [
      "APIA_QA.pdf",
      "guide_de_l_investisseur-etranger.pdf",
      "Guide_Global.pdf",
      "guide_societes_communautaires.pdf",
      "RAPPORT_2025_PUBLIQUE.pdf",
      "Rapport_Comite_Inv.pdf",
      "Site_web.pdf"
    ];

    const baseUrl = new URL(request.url).origin;
    const attachedFilesParts = [];

    // 🌟 جلب وتحويل التقارير الـ 7 بشكل متوازٍ وسريع
    const fetchPromises = fileNames.map(async (fileName) => {
      try {
        const fileUrl = `${baseUrl}/reports/${fileName}`;
        const fileResponse = await fetch(fileUrl);
        if (fileResponse.ok) {
          const arrayBuffer = await fileResponse.arrayBuffer();
          const bytes = new Uint8Array(arrayBuffer);
          let binary = "";
          for (let i = 0; i < bytes.byteLength; i += 8000) {
            const chunk = bytes.subarray(i, i + 8000);
            binary += String.fromCharCode.apply(null, chunk);
          }
          return {
            inlineData: {
              mimeType: "application/pdf",
              data: btoa(binary)
            }
          };
        }
      } catch (e) {}
      return null;
    });

    const resolvedFiles = await Promise.all(fetchPromises);
    for (const file of resolvedFiles) {
      if (file) attachedFilesParts.push(file);
    }

    const systemInstruction = `
أنت الخبير والمنسق الرسمي لوكالة النهوض بالاستثمارات الفلاحية (APIA) في تونس. 
أجب بدقة وموثوقية عالية، وبتفصيل كامل دون اختصار مخل بالاستناد حصرياً إلى الملفات المرفقة صلب الجلسة.

قواعد تشغيلية حاسمة لا تنازل عنها:
1. الالتزام المطلق بلغة السؤال: يجب كشف لغة سؤال المستخدم فوراً والإجابة حصرياً وبشكل كامل بنفس اللغة. إذا كان السؤال بالعربية، يمنع منعاً باتاً صياغة الإجابة أو الجداول أو العناوين باللغة الإنجليزية.
2. غزارة المعلومات وتفصيلها: يمنع الاختصار التلقائي؛ قم بسرد الشروط القانونية، النسب المئوية، والخطوات الإدارية كاملة كما وردت في الوثائق.
3. منع ذكر المصادر: لا تذكر أسماء ملفات الـ PDF أو العناوين مثل "وفقاً للملف المرفق"، قدم المعلومة مباشرة كخبير واثق ومسؤول.
4. الجداول المنظمة: استخدم جداول الماركداون (Markdown Tables) حصرياً عند عرض المقارنات والأرقام والنسب المئوية والمنح المالية صلب الإجابة لتظهر بشكل تنفيذي فاخر.
5. غياب المعلومة: إذا كانت تفاصيل السؤال غير موجودة بالملفات، أجب بدقة بهذه الجملة دون زيادة: "عذراً، هذه المعلومة غير متوفرة حالياً في مصادري الرسمية، يرجى التواصل مباشرة مع مصالح الوكالة أو التواصل مع المشرف: kouki.riadh@apia.com.tn" (وتقوم بترجمتها للفرنسية أو الإنجليزية إن كان السؤال بتلك اللغات).
`;    

    // تنظيف وتجهيز الـ History الممرر بالكامل دون قص جائر لضمان عدم ضياع السياق
    const safeHistory = (history || []).map(turn => ({
      role: turn.role === "assistant" ? "model" : turn.role,
      parts: turn.parts
    }));

    // 🌟 لتفادي اختصار الإجابات وتشتت النموذج: ندمج الملفات الـ 7 دائماً في الطلب الحالي كمرجع ثابت وثقيل
    const contents = [
      ...safeHistory,
      { 
        role: "user", 
        parts: [
          ...attachedFilesParts,
          { text: message }
        ] 
      }
    ];

    // حصر إجمالي الذاكرة المنقولة بـ 6 عناصر (3 حوارات كاملة مع الوثائق) لضمان التوازن المثالي والعمق
    if (contents.length > 7) {
      // نحافظ على الوثائق في الطلب الأخير دائماً ونأخذ الحوارات السابقة القريبة فقط
      const recentHistory = safeHistory.slice(-4);
      contents.length = 0; // تصفير
      contents.push(...recentHistory, { role: "user", parts: [...attachedFilesParts, { text: message }] });
    }

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const MAX_RETRIES = 3;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(geminiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: contents,
            systemInstruction: { parts: [{ text: systemInstruction }] },
            generationConfig: {
              temperature: 0.2, // الحفاظ على دقة التقارير الرسمية للعربية والتفاصيل وثباتها
              topP: 0.95
            }
          })
        });

        const data = await response.json();

        if (!response.ok && (response.status === 429 || response.status === 503)) {
          if (attempt < MAX_RETRIES) {
            const delay = Math.pow(2, attempt + 1) * 1000;
            await new Promise(resolve => setTimeout(resolve, delay));
            continue; 
          }
        }

        if (!response.ok) {
          return new Response(JSON.stringify({ error: data.error?.message || "خطأ من سيرفر جوجل" }), {
            status: response.status,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const botReply = data.candidates?.[0]?.content?.parts?.[0]?.text || "لم أتمكن من صياغة إجابة.";
        return new Response(JSON.stringify({ reply: botReply }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });

      } catch (fetchError) {
        if (attempt < MAX_RETRIES) {
          const delay = Math.pow(2, attempt + 1) * 1000;
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
      }
    }

    return new Response(JSON.stringify({ error: "تعذر الاتصال بالخادم بعد عدة محاولات." }), {
      status: 503,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    }
  });
}
