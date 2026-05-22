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

    // 🌟 التحديث الثوري المعتمد على الـ IDs الرسمية لملفاتك على Google Drive
    // نقوم بتمرير مسارات الوثائق السبعة مباشرة في أول رسالة لتستقبلها سيرفرات جوجل العملاقة
    if (safeHistory.length === 0) {
      const googleDriveFiles = [
        { id: "1XpRZrkYDsUMcpvK25WIAWtchNU298OhE", name: "Site_web.pdf" },
        { id: "1HDbaY41HCScAYGG05IXLHXMmXDvaZ1kO", name: "Rapport_Comite_Inv.pdf" },
        { id: "1HuuawwJyMi6jr_wZkBnzq8FgtUf6w4Kj", name: "Guide_Global.pdf" },
        { id: "1cqdxG5i34u3DR7F_Sq3O3RSfVIL0ib8h", name: "APIA_QA.pdf" },
        { id: "1ly7wtvSxew67FiX44idaohXcyghlqVfE", name: "RAPPORT_2025_PUBLIQUE.pdf" },
        { id: "1CeOod_1Oq_PRmxDdNfg08TwhRvBwpBRz", name: "guide_societes_communautaires.pdf" },
        { id: "1yb0ItxKrIpcmlwekIU29gtD2e3RbAEHc", name: "guide_de_l_investisseur-etranger.pdf" }
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

    // بناء مصفوفة المحتويات بشكل نظيف وخفيف جداً على الذاكرة الطرفية لـ Cloudflare
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
