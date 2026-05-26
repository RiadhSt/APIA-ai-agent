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

    // 1. إنشاء الكاش التلقائي بالبنية السليمة
    if (!globalCacheName || currentTime >= cacheExpireTime) {
      const createCacheUrl = `https://generativelanguage.googleapis.com/v1beta/cachedContents?key=${apiKey}`;
      
      const cacheBody = {
        model: "models/gemini-2.5-flash",
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `أنت المساعد الذكي لوكالة (APIA). التزم حرفياً بقاعدة البيانات الرسمية التالية وسرد كامل التفاصيل والشروط والنسب دون أي اختصار، وقدم إجاباتك مباشرة دون ذكر المصادر:\n\n${myKnowledgeBase}`
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

    // 2. بناء السجل القياسي النقي (مصفوفة نظيفة تبدأ بالسجل وتنتهي بسؤال المستخدم)
    const contents = [];

    if (history && history.length > 0) {
      history.forEach(turn => {
        contents.push({
          role: turn.role === "assistant" ? "model" : turn.role,
          parts: (typeof turn.parts === "string") ? [{ text: turn.parts }] : turn.parts
        });
      });
    }

    // حقن القواعد الحاسمة (اللغة والجداول) ملتصقة ومباشرة بسؤال المستخدم الحالي لمنع التجميد والعطالة اللغوية
    const formattedPrompt = `[قواعد تشغيلية فورية:
1. أجب حصرياً بنفس لغة هذا السؤال تماماً (إذا كان بالإنجليزية أجب بالإنجليزية، فرنسي بالفرنسية، عربي بالعربية).
2. اعرض كافة الأرقام، النسب المئوية، والمنح المالية حصرياً في جداول ماركداون (Markdown Tables) واضحة ومحاذية بلغة السؤال، ويُمنع سردها في نصوص].

سؤال المستخدم: ${message}`;

    contents.push({
      role: "user",
      parts: [{ text: formattedPrompt }]
    });

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    
    const requestBody = {
      contents: contents,
      generationConfig: {
        temperature: 0.0, // صفر تلاعب لضمان الحتمية القانونية والالتزام بالجدول
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
