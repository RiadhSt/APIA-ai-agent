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

    const attachedFilesParts = [];
    const baseUrl = new URL(request.url).origin;

    for (const fileName of fileNames) {
      try {
        const fileUrl = `${baseUrl}/reports/${fileName}`;
        const fileResponse = await fetch(fileUrl);
        
        if (fileResponse.ok) {
          const arrayBuffer = await fileResponse.arrayBuffer();
          const bytes = new Uint8Array(arrayBuffer);
          let binary = "";
          for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
          const base64Data = btoa(binary);

          attachedFilesParts.push({
            inlineData: {
              mimeType: "application/pdf",
              data: base64Data
            }
          });
        }
      } catch (e) {}
    }

    // تعليمات واضحة، باللغة العربية، دون تعقيد لمنع خلط اللغات والبطء
    const systemInstruction = "أنت خبير وكالة APIA المعتمد. أجب بدقة وعمق اعتماداً حصرياً على الملفات المرفقة. أجب دائماً بنفس لغة السؤال (إذا سألك بالفرنسية أجب بالفرنسية، وإذا سألك بالعربية أجب بالعربية). لا تذكر أسماء الملفات أو المصادر في إجابتك نهائياً. استخدم الجداول فقط عند وجود أرقام ونسب مئوية ومقارنات مالية تستدعي ذلك.";
    
    // تنظيف التاريخ لتفادي خطأ Role assistant
    const safeHistory = (history || []).map(turn => ({
      role: turn.role === "assistant" ? "model" : turn.role,
      parts: turn.parts
    }));

    const currentContent = { 
      role: "user", 
      parts: [
        ...attachedFilesParts,
        { text: message }
      ] 
    };

    const contents = [...safeHistory.slice(-2), currentContent];
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const MAX_RETRIES = 3;
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

        if (!response.ok && (response.status === 429 || response.status === 503)) {
          if (attempt < MAX_RETRIES) {
            const delay = Math.pow(2, attempt + 1) * 1000;
            await new Promise(resolve => setTimeout(resolve, delay));
            continue; 
          }
        }

        if (!response.ok) {
          return new Response(JSON.stringify({ error: data.error?.message || "خطأ من سيرفر" }), {
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

    return new Response(JSON.stringify({ error: "تعذر الاتصال بالخادم." }), {
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
