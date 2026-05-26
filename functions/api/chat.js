import { myKnowledgeBase } from "./knowledge.js";

// متغيرات ديناميكية لحفظ الكاش حياً في الذاكرة السحابية المؤقتة
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

    // 1. التوليد والتجديد التلقائي للكاش المدفوع (لضمان السرعة وتوفير التكلفة)
    if (!globalCacheName || currentTime >= cacheExpireTime) {
      const createCacheUrl = `https://generativelanguage.googleapis.com/v1beta/cachedContents?key=${apiKey}`;
      
      const cacheBody = {
        model: "models/gemini-2.5-flash",
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `أنت المساعد الذكي لوكالة (APIA). التزم صارماً بالقواعد التشغيلية التالية:
1. لغة الإجابة: تطابق لغة سؤال المستخدم تماماً (عربي/فرنسي) بما في ذلك الجداول والمصطلحات.
2. غزارة المعلومات: اسرد كامل الشروط القانونية والنسب والخطوات الإدارية دون أي اختصار مخل وبأعلى أمانة للنص.
3. أولوية السياق: إذا تضارب الدليل السريع مع الأقسام الهيكلية، اعتمد دائماً التفاصيل الشاملة الواردة في الأقسام الهيكلية الأخرى.
4. حظر المصادر: قدم المعلومة مباشرة كمساعد رسمي، ويُمنع تماماً قول "وفقاً للملف" أو "بحسب قاعدة البيانات".
5. التنسيق الإجباري للجداول: يُمنع سرد الأرقام، النسب المئوية، والمبالغ المالية داخل نصوص إنشائية متصلة. يجب تحويلها وعرضها دائماً حصرياً في جداول ماركداون (Markdown Tables) واضحة ومحاذية.

إليك قاعدة البيانات الرسمية الشاملة لاعتمادها حرفياً:
${myKnowledgeBase}`
              }
            ]
          }
        ],
        ttl: "86400s" // صلاحية الكاش 24 ساعة كاملة على سيرفرات جوجل
      };

      const cacheResponse = await fetch(createCacheUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cacheBody)
      });

      if (cacheResponse.ok) {
        const cacheData = await cacheResponse.json();
        globalCacheName = cacheData.name;
        cacheExpireTime = currentTime + (23 * 60 * 60 * 1000); // تجديد تلقائي قبل الانتهاء بساعة
      }
    }

    // 2. بناء سجل المحادثة خفيف ونقي جداً ليتطابق مع الـ Cache
    const safeHistory = (history || []).map(turn => ({
      role: turn.role === "assistant" ? "model" : turn.role,
      parts: (typeof turn.parts === "string") ? [{ text: turn.parts }] : turn.parts
    }));

    const contents = [
      ...safeHistory,
      {
        role: "user",
        parts: [{ text: message }]
      }
    ];

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    
    const requestBody = {
      contents: contents,
      generationConfig: {
        temperature: 0.0, // صفر تلاعب لضمان الحتمية القانونية والتنسيق الصارم للجداول
        topP: 0.95
      }
    };

    // ربط الطلب بالكاش التلقائي
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
