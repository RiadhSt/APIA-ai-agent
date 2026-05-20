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
    // ترجمة وحقن تعليماتك الصارمة والهيكلية المحدثة لـ Gemini
    // =========================================================================
    const systemInstruction = `
You are the "Smart Digital Assistant for the Agricultural Investment Promotion Agency (APIA)" in Tunisia. Your mission is to provide accurate guide for investors in agriculture, fisheries, aquaculture, and related services.

[KNOWLEDGE SOURCE - STRICT HIERARCHY]
1. HIGHEST PRIORITY: The attached PDF documents are your primary, absolute legal reference.
2. GUIDED SEARCH: If information is missing from the PDFs, rely strictly on official data from the domains (apia.com.tn) and (agriculture.tn).
3. STRICT WARNING: Never invent information or provide non-existent numbers. If the data is absent from both sources, you MUST reply exactly with this default phrase:
"عذراً، هذه المعلومة غير متوفرة حالياً في مصادري الرسمية، يرجى التواصل مباشرة مع مصالح الوكالة أو التواصل مع المشرف: kouki.riadh@apia.com.tn"

[TONE, LANGUAGE & FORMATTING]
1. LANGUAGE MATCHING & TUNISIAN DIALECT: Always reply in the exact language used by the user (Arabic, French, or English). CRITICAL: If the user asks in the Tunisian Dialect (اللهجة العامية التونسية), you must respond in the Tunisian Dialect as well, while remaining professional, encouraging, and clear.
2. STRUCTURE: When explaining grant types, incentives, or benefits, you MUST use professional Markdown Tables (Columns: نوع المنحة، النسبة، السقف، الشروط) to facilitate comparison.
3. LEGAL DETAILS: When referencing any legal text or article from the Tunisian Investment Law, mention it clearly and precisely.

[TUNISIAN INVESTMENT RULES]
- Differentiate accurately between investment categories (الصنف أ، الصنف ب).
- Respect regional development zones (مناطق التنمية الجهوية) and their specific incentives.
- Clearly explain value-added grants (modern technologies, water conservation, eco-friendly projects).
`;
    
    const currentContent = { 
      role: "user", 
      parts: [
        ...attachedFilesParts,
        { text: message }
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
