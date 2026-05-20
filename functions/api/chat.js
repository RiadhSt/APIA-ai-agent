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

    const attachedFilesParts = [];
    const baseUrl = new URL(request.url).origin;

    // 2. جلب الملفات حياً من المستودع وتحويلها إلى حزم ليفهمها السيرفر
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
      } catch (e) {
        // إذا فشل جلب ملف نتابع البقية لضمان استقرار البوت
      }
    }

const systemInstruction = `
You are the official AI expert for the Agricultural Investment Promotion Agency (APIA) in Tunisia. Answer accurately and comprehensively, strictly based on the attached files, you can summarize text but no omission of technical data and legal ratios.

CRITICAL OPERATIONAL RULES:
1. STRICT LANGUAGE MATCHING: You MUST detect the language of the user's prompt (French, English, Arabic, or Tunisian Dialect) and reply EXCLUSIVELY in that SAME LANGUAGE. Never answer in Arabic if the question is in French or English or other language.
2. NO SOURCE CITATION: Do NOT mention any file names, document titles, or phrases like "according to the attached PDF". Deliver the information directly as your own authoritative answer.
3. CONDITIONAL TABLES: Use Markdown tables ONLY when displaying or comparing multiple numbers, percentages, financial grants, or loans. For general or conceptual explanations, use natural fluid text or bullet points instead of forcing a table.
4. MISSING DATA: If the required details are completely absent from the documents, reply exactly with: "عذراً، هذه المعلومة غير متوفرة حالياً في مصادري الرسمية، يرجى التواصل مباشرة مع مصالح الوكالة أو التواصل مع المشرف: kouki.riadh@apia.com.tn" (You must translate this exact phrase into French or English if the user's query is in French or English).
`;    
    // دمج محتوى ملفات الـ PDF الحية مع سؤال المستخدم
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

    // ===== منطق إعادة المحاولة الذكي من إقتراح نموذج كلوفلير (Retry with Exponential Backoff) =====
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

        // إذا كان الخطأ بسبب الطلب المرتفع (429 أو 503)، أعد المحاولة تلقائياً بانتظار تصاعدي
        if (!response.ok && (response.status === 429 || response.status === 503)) {
          lastError = data.error?.message || "الخادم مشغول حالياً";
          
          if (attempt < MAX_RETRIES) {
            // انتظار تضاعفي: 2ث -> 4ث -> 8ث
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

        // أي خطأ آخر (خارج نطاق الـ Rate Limit)
        if (!response.ok) {
          return new Response(JSON.stringify({ error: data.error?.message || "خطأ من سيرفر جوجل" }), {
            status: response.status,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        // نجاح العملية - استخراج وإرسال الرد
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
