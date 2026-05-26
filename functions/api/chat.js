import { myKnowledgeBase } from "./knowledge.js";

let globalCacheName = null;
let cacheExpireTime = 0;

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

    const currentTime = Date.now();

    // 1. إدارة وتوليد الكاش التلقائي
    if (!globalCacheName || currentTime >= cacheExpireTime) {
      const createCacheUrl = `https://generativelanguage.googleapis.com/v1beta/cachedContents?key=${apiKey}`;
      
      const cacheBody = {
        model: "models/gemini-2.5-flash",
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `You are the Smart Assistant for the Agricultural Investment Promotion Agency (APIA). Strictly adhere to these operational rules:
1. LANGUAGE MATCHING (CRITICAL): Detect the user's input language. If the user asks in English, reply in English. If in French, reply in French. If in Arabic, reply in Arabic. Never mix or use a different language for text, terms, or tables.
2. COMPREHENSIVENESS: Provide full legal conditions, percentages, and administrative steps in maximum detail without any omission.
3. CONTEXT PRIORITY: If there is a conflict between the Quick FAQ and the structural sections, always prioritize the detailed structural sections.
4. SOURCE HIDDEN: Reply directly as an official system. Never mention "according to the document" or "in the database".
5. FORMATTING: Never write numbers, percentages, or financial grants inside raw text. Format them exclusively in clean, aligned Markdown tables matching the query language.

Official Database:
${myKnowledgeBase}`
              }
            ]
          }
        ],
        ttl: "86400s"
      };

      const cacheResponse = await fetch(createCacheUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cacheBody)
      });

      if (cacheResponse.ok) {
        const cacheData = await cacheResponse.json();
        globalCacheName = cacheData.name;
        cacheExpireTime = currentTime + (23 * 60 * 60 * 1000);
      }
    }

    // 2. تعديل الرسالة التمهيدية للموديل لتكون متعددة اللغات لكسر العطالة اللغوية
    const contents = [
      {
        role: "model",
        parts: [{ text: "Understood. I am the APIA Smart Assistant. I will strictly apply the 5 operational rules and reply using the EXACT language of the user (Arabic/French/English) with precise Markdown tables." }]
      }
    ];

    if (history && history.length > 0) {
      history.forEach(turn => {
        contents.push({
          role: turn.role === "assistant" ? "model" : turn.role,
          parts: (typeof turn.parts === "string") ? [{ text: turn.parts }] : turn.parts
        });
      });
    }

    // حقن أمر لغوي لحظي مصاحب للسؤال الحالي لكسر عناد الموديل
    contents.push({
      role: "user",
      parts: [{ text: `[SYSTEM NOTE: Reply exclusively in the language of this prompt. Do not use Arabic if this prompt is in English/French].\n\nUser Question: ${message}` }]
    });

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    
    const requestBody = {
      contents: contents,
      generationConfig: {
        temperature: 0.0,
        topP: 0.95
      }
    };

    if (globalCacheName) {
      requestBody.cachedContent = globalCacheName;
    }

    const response = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      return new Response(JSON.stringify({ error: data.error?.message || "خطأ في الاتصال بسيرفر جوجل" }), {
        status: response.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const data = await response.json();
    const candidate = data.candidates?.[0];
    let botReply = "";

    if (candidate && candidate.content && candidate.content.parts) {
      const textParts = candidate.content.parts
        .filter(part => !part.thought && part.text)
        .map(part => part.text);
      botReply = textParts.join("\n");
    }

    if (!botReply) botReply = "لم أتمكن من صياغة إجابة.";

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
