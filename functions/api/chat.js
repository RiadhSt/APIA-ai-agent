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

    // 1. مصفوفة بأسماء الملفات المرفوعة في مجلد reports على GitHub
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

    // 2. جلب وتحويل جميع الملفات بالتوازي دفعة واحدة (Parallel Fetching) لضمان السرعة
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
      } catch (e) {
        return null;
      }
      return null;
    });

    const resolvedFiles = await Promise.all(fetchPromises);
    const attachedFilesParts = resolvedFiles.filter(file => file !== null);

    // 3. تعليمات لغوية وتنظيمية خارقة الصرامة بالإنجليزي لمنع العناد اللغوي للموديل
    const systemInstruction = `
You are the official AI expert for the Agricultural Investment Promotion Agency (APIA) in Tunisia. Answer accurately and comprehensively, strictly based on the attached files, with no summarization or omission of technical data and legal ratios.

CRITICAL OPERATIONAL RULES:
1. STRICT LANGUAGE MATCHING: You MUST detect the language of the user's prompt (French, English, Arabic, or Tunisian Dialect) and reply EXCLUSIVELY in that SAME LANGUAGE. If the user asks in French, translate the Arabic source data instantly and answer in fluent, professional French. Never answer in Arabic if the question is in French or English.
2. NO SOURCE CITATION: Do NOT mention any file names, document titles, or phrases like "according to the attached PDF". Deliver the information directly as your own authoritative answer.
3. CONDITIONAL TABLES: Use Markdown tables ONLY when displaying or comparing multiple numbers, percentages, financial grants, or loans. For general or conceptual explanations, use natural fluid text or bullet points instead of forcing a table.
4. MISSING DATA: If the required details are completely absent from the documents, reply exactly with: "عذراً، هذه المعلومة غير متوفرة حالياً في مصادري الرسمية، يرجى التواصل مباشرة مع مصالح الوكالة أو التواصل مع المشرف: kouki.riadh@apia.com.tn" (You must translate this exact phrase into French or English if the user's query is in French or English).
`;
    
    // 4. تطهير الحوار لضمان عدم تعارض الـ Roles
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

    // ===== منطق إعادة المحاولة الذكي عند الضغط العالي =====
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
          return new Response(JSON.stringify({ error: "النموذج يواجه ضغطاً حالياً. أعد المحاولة بعد ثوانٍ." }), {
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
        if (attempt < MAX_RETRIES) {
          const delay = Math.pow(2, attempt + 1) * 1000;
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
      }
    }

    return new Response(JSON.stringify({ error: "تعذر الاتصال بالخادم. يرجى المحاولة لاحقاً." }), {
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
