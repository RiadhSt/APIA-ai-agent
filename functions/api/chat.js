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

    // تنظيف وتجهيز الـ History مع تحويل الأدوار لضمان الثبات
    const safeHistory = (history || []).map(turn => ({
      role: turn.role === "assistant" ? "model" : turn.role,
      parts: turn.parts
    }));

    const attachedFilesParts = [];
    const baseUrl = new URL(request.url).origin;

    // 🌟 استنساخ منطق بايثون: نقوم بجلب وتحميل الملفات فقط في السؤال الأول لتقليل حجم السياق ومنع التشتت
    if (safeHistory.length === 0) {
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
            const base64Data = btoa(binary);
            return {
              inlineData: {
                mimeType: "application/pdf",
                data: base64Data
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
    }

    // صياغة الـ systemInstruction المحدث بلغة عربية حازمة لضمان فرضه كلياً على الذاكرة
    const systemInstruction = `
أنت الخبير والمنسق الرسمي لوكالة النهوض بالاستثمارات الفلاحية (APIA) في تونس. 
أجب بدقة وموثوقية عالية بالاستناد حصرياً إلى الملفات المرفقة.

قواعد تشغيلية حاسمة لا تنازل عنها:
1. الالتزام المطلق بلغة السؤال: يجب كشف لغة سؤال المستخدم فوراً (سواء كانت عربية، فرنسية، أو إنجليزية) والإجابة حصرياً وبشكل كامل بنفس اللغة. إذا كان السؤال بالعربية، يمنع منعاً باتاً صياغة الإجابة أو الجداول أو العناوين باللغة الإنجليزية.
2. منع ذكر المصادر: لا تذكر أسماء ملفات الـ PDF أو العناوين مثل "وفقاً للملف المرفق"، قدم المعلومة مباشرة كخبير واثق ومسؤول.
3. الجداول المنظمة: استخدم جداول الماركداون (Markdown Tables) حصرياً عند عرض المقارنات والأرقام والنسب المئوية والمنح المالية صلب الإجابة لتظهر بشكل تنفيذي فاخر.
4. غياب المعلومة: إذا كانت تفاصيل السؤال غير موجودة بالملفات، أجب بدقة بهذه الجملة دون زيادة: "عذراً، هذه المعلومة غير متوفرة حالياً في مصادري الرسمية، يرجى التواصل مباشرة مع مصالح الوكالة أو التواصل مع المشرف: kouki.riadh@apia.com.tn" (وتقوم بترجمتها للفرنسية أو الإنجليزية إن كان السؤال بتلك اللغات).
`;    

    // بناء سياق السؤال الحالي بشكل نظيف وخالٍ من الملفات المكررة في حال استمرار الحوار
    const currentContent = { 
      role: "user", 
      parts: [
        ...attachedFilesParts, // ستكون مصفوفة فارغة تلقائياً إذا كنا في السؤال الثاني أو الثالث
        { text: message }
      ] 
    };

    // الاحتفاظ بآخر حوارين مع السؤال الحالي النظيف لمنع الهذيان والخلط
    const contents = [...safeHistory.slice(-4), currentContent];
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
              temperature: 0.15, // خفض درجة الابتكار إلى الحد الأدنى لفرض القواعد واللغة بصرامة
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
