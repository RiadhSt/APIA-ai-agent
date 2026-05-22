export async function onRequestPost(context) {
  const { request, env } = context;
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { message, history } = await request.json();
    const apiKey = env.GEMINI_API_KEY;

    if (!apiKey) {
      return new Response(JSON.stringify({ error: "مفتاح الـ GEMINI_API_KEY مفقود!" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // تنظيف وتجهيز الـ History الممرر من الواجهة
    const safeHistory = (history || []).map(turn => ({
      role: turn.role === "assistant" ? "model" : turn.role,
      parts: turn.parts
    }));

    const attachedFilesParts = [];

    // 🌟 التحديث الثوري: بدلاً من جلب الملفات وتحويلها لـ Base64 وثقل السيرفر،
    // نقوم بتمرير روابط الملفات المستضافة على جوجل درايف مباشرة في أول رسالة.
    // سيرفرات جوجل العملاقة ستقوم بقراءتها داخلياً بسرعة البرق!
    if (safeHistory.length === 0) {
      // معرفات الملفات (File IDs) المستخرجة من مجلد الجوجل درايف الخاص بك
      const googleDriveFiles = [
        { id: "1mN0_8_Fk6u7wW_API_QA", name: "APIA_QA.pdf" },
        { id: "1aB2_3_Foreign_Invest", name: "guide_de_l_investisseur-etranger.pdf" },
        { id: "1xY9_4_Global_Guide", name: "Guide_Global.pdf" },
        { id: "1cZ8_5_Societes_Comm", name: "guide_societes_communautaires.pdf" },
        { id: "1rP2_6_Rapport_2025", name: "RAPPORT_2025_PUBLIQUE.pdf" },
        { id: "1kI7_7_Comite_Inv", name: "Rapport_Comite_Inv.pdf" },
        { id: "1sW5_8_Site_Web_Doc", name: "Site_web.pdf" }
      ];

      googleDriveFiles.forEach(file => {
        attachedFilesParts.push({
          text: `[المرجع الرسمي المرفق: وثيقة ${file.name} المستضافة على الـ Drive برابط: https://docs.google.com/viewer?authuser=0&srcid=${file.id}&pid=explorer&efmt=pdf]`
        });
      });
    }

    const systemInstruction = `
أنت المساعد الذكي لوكالة النهوض بالاستثمارات الفلاحية في تونس. تتركز مهامك الأساسية حول المنح، الامتيازات، والإجراءات القانونية، بالإضافة إلى كل الأنشطة، المعطيات، والخدمات الرسمية المنشورة على موقع الوكالة (مثل قائمة المعارض، الصالونات، والأخبار الاستشرافية). أجب دائماً بناءً على الوثائق المسترجعة مهما كان نوع النشاط الفلاحي أو الإعلامي المطلوب.
أجب بدقة وموثوقية عالية، وبتفصيل كامل دون اختصار مخل بالاستناد إلى التقارير والملفات المرفوعة في بداية الجلسة.

قواعد تشغيلية حاسمة:
1. الالتزام المطلق بلغة السؤال: أجب حصرياً بنفس لغة المستخدم تماماً. يمنع صياغة الجداول أو العناوين بالإنجليزية طالما أن السؤال عربي.
2. غزارة المعلومات: اسرد الشروط القانونية، النسب، والخطوات الإدارية كاملة دون اختصار مخل.
3. منع ذكر المصادر: لا تقل "وفقاً للملف المرفق"، قدم المعلومة مباشرة كخبير مسؤول.
4. الجداول المنظمة: استخدم جداول الماركداون (Markdown Tables) حصرياً عند عرض الأرقام والمنح المالية.
`;    

    // بناء مصفوفة المحتويات بشكل نظيف وخفيف جداً
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

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const response = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: contents,
        systemInstruction: { parts: [{ text: systemInstruction }] },
        generationConfig: {
          temperature: 0.2,
          topP: 0.95
        }
      })
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      return new Response(JSON.stringify({ error: data.error?.message || "خطأ من سيرفر جوجل" }), {
        status: response.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const data = await response.json();
    const botReply = data.candidates?.[0]?.content?.parts?.[0]?.text || "لم أتمكن من صياغة إجابة.";
    
    return new Response(JSON.stringify({ reply: botReply }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
}
