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

    // 2. جلب الملفات بشكل متوازٍ وسريع جداً (Parallel Fetching)
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
      } catch (e) {
        return null;
      }
      return null;
    });

    const resolvedFiles = await Promise.all(fetchPromises);
    const attachedFilesParts = resolvedFiles.filter(file => file !== null);

    // =========================================================================
    // التوجيهات المرنة والمحكمة: جداول مشروطة، التزام لغوي مطلق، واختصار
    // =========================================================================
    const systemInstruction = `
You are the AI Digital Assistant for APIA Tunisia. Analyze the attached PDFs and answer according to these STRICT operational rules:

1. ABSOLUTE LANGUAGE MATCH: Detect the language of the user's prompt (English, French, Arabic, or Tunisian Dialect) and reply ALWAYS in the EXACT SAME LANGUAGE. Never mix or switch languages, even if the source documents are in Arabic.
2. MAXIMUM BREVITY: Be extremely concise, short, and direct. Remove all introductory phrases or fillers. Deliver the information directly without losing any technical accuracy, numbers, or legal ratios.
3. NO SOURCE MENTION: Do NOT mention, cite, or reference any of the file names, document titles, or sources. Deliver the information directly as your own authoritative answer.
4. CONDITIONAL TABLES: Use Markdown tables ONLY when presenting multiple percentages, grants, or complex financial comparisons that naturally require structured data. For simple or direct answers, use concise bullet points or short text instead of forcing a table.
5. MISSING DATA: If information is totally absent from the sources, reply exactly with: 
"عذراً، هذه المعلومة غير متوفرة حالياً في مصادري الرسمية، يرجى التواصل مباشرة مع مصالح الوكالة أو التواصل مع المشرف: kouki.riadh@apia.com.tn" (Translate this specific phrase to the user's language if they ask in English or French).
`;
    
    // تنظيف التاريخ وتحويل أي دور 'assistant' إلى 'model' لتجنب رفض جوجل الصارم
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
