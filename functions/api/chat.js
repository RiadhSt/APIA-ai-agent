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

    // 1. أسماء ملفات الأدلة والتقارير المرفوعة في مجلد reports على GitHub
    const fileNames = [
      "APIA_QA.pdf",
      "guide_de_l_investisseur-etranger.pdf",
      "Guide_Global.pdf",
      "guide_societes_communautaires.pdf",
      "RAPPORT_2025_PUBLIQUE.pdf",
      "Rapport_Comite_Inv.pdf",
      "Site_web.pdf"
    ];

    const attachedFilesParts = [];
    const baseUrl = new URL(request.url).origin;

    // 2. بدلاً من تحميل الملفات وتحويلها، سنقوم بتوجيه Gemini لقراءة روابطها مباشرة لتوفير الوقت والذاكرة
    for (const fileName of fileNames) {
      const fileUrl = `${baseUrl}/reports/${fileName}`;
      attachedFilesParts.push({
        text: `المصدر المرجعي المتاح للقراءة الحية: [${fileName}] رابط الملف للتحليل: ${fileUrl}\n`
      });
    }

    const systemInstruction = "أنت خبير وكالة APIA المعتمد. أجب بدقة وعمق اعتماداً حصرياً على ملفات المراجع المرفقة واستخدم الجداول للأرقام والمنح والقروض. الالتزام الصارم بعدم تبسيط المحتوى الفني أو القانوني، ولا تقم بتغيير أو حذف أي أرقام أو نسب مئوية.";
    
    // دمج الإشارات المرجعية الحية للملفات مع سؤال المستخدم
    const currentContent = { 
      role: "user", 
      parts: [
        ...attachedFilesParts,
        { text: `سؤال المستخدم الحالي: ${message}` }
      ] 
    };

    const trimmedHistory = history ? history.slice(-2) : [];
    const contents = [...trimmedHistory, currentContent];
    
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    // ===== منطق إعادة المحاولة الذكي (Retry with Exponential Backoff) =====
    const MAX_RETRIES = 3;
    let lastError = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(geminiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: contents,
            systemInstruction: { parts: [{ text: systemInstruction }] }
          })
        });

        const data = await response.json();

        // إعادة المحاولة عند الضغط العالي (429 أو 503)
        if (!response.ok && (response.status === 429 || response.status === 503)) {
          lastError = data.error?.message || "الخادم مشغول حالياً";
          
          if (attempt < MAX_RETRIES) {
            const delay = Math.pow(2, attempt + 1) * 1000;
            await new Promise(resolve => setTimeout(resolve, delay));
            continue; 
          }
          
          return new Response(JSON.stringify({ 
            error: "النموذج يواجه طلباً مرتفعاً حالياً. يرجى إعادة المحاولة بعد بضع ثوان." 
          }), {
            status: response.status,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
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
        lastError = fetchError;
        if (attempt < MAX_RETRIES) {
          const delay = Math.pow(2, attempt + 1) * 1000;
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
      }
    }

    return new Response(JSON.stringify({ 
      error: "تعذر الاتصال بالخادم بعد عدة محاولات. يرجى المحاولة لاحقاً." 
    }), {
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
