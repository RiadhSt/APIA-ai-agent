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
    
    // تأكد أن هذا المعرّف هو آخر معرّف نشط قمت بتوليده من Postman
    const cacheName = "cachedContents/g9f2il1zhqqledg5q261jggjdrvy38v2m52xdmxm";

    if (!apiKey) {
      return new Response(JSON.stringify({ error: "مفتاح الـ GEMINI_API_KEY مفقود!" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // بناء سجل المحادثة بشكل نقي تماماً متوافق مع الكاش المخزن
    const safeHistory = (history || []).map(turn => ({
      role: turn.role === "assistant" ? "model" : turn.role,
      parts: (typeof turn.parts === "string") ? [{ text: turn.parts }] : turn.parts
    }));

    // إضافة سؤال المستخدم الحالي بشكل نقي وصافٍ دون أي إضافات تكسر الكاش
    const contents = [
      ...safeHistory,
      {
        role: "user",
        parts: [{ text: message }]
      }
    ];

    // الرابط القياسي المباشر لـ generateContent
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const response = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: contents,
        cachedContent: cacheName, // استدعاء الكاش الصافي هنا
        generationConfig: {
          temperature: 0.2,
          topP: 0.95
        }
      })
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      // إذا انتهت صلاحية الكاش، سيعطينا السيرفر تنبيهاً واضحاً هنا بدلاً من التأخير صامتاً
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
