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
    
    // حقن المعرّف مباشرة هنا لضمان قراءته بشكل صحيح 100% وبدون الاعتماد مؤقتاً على إعدادات المنصة
    const cacheName = "cachedContents/8ifnvtga4d30om4mbzm8mphbkrzyy11cdcfd2jz";

    if (!apiKey) {
      return new Response(JSON.stringify({ error: "مفتاح الـ GEMINI_API_KEY مفقود!" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // سجل المحادثة وتعديل الأدوار
    const safeHistory = (history || []).map(turn => ({
      role: turn.role === "assistant" ? "model" : turn.role,
      parts: (typeof turn.parts === "string") ? [{ text: turn.parts }] : turn.parts
    }));

    // دمج التوجيه مع سؤال المستخدم لتفادي قيود الـ systemInstruction مع الكاش
    const contents = [
      ...safeHistory,
      {
        role: "user",
        parts: [
          { 
            text: `توجيهات صارمة: أجب بدقة وتفصيل شديد وغزارة في المعلومات بناءً على قاعدة المعرفة المخزنة في الكاش الخاص بك ومستنداً لقوانين وكالة النهوض بالاستثمارات الفلاحية (APIA). التزم تماماً بلغة المستخدم واستخدم جداول الماركداون للتنظيم المالي.\n\nسؤال المستخدم الحالي هو: ${message}` 
          }
        ]
      }
    ];

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const response = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: contents,
        cachedContent: cacheName,
        generationConfig: {
          temperature: 0.1,
          topP: 0.95
        }
      })
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      return new Response(JSON.stringify({ error: data.error?.message || "خطأ في معالجة طلب الكاش من سيرفر جوجل" }), {
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

    if (!botReply) botReply = "لم أتمكن من صياغة إجابة من الكاش المستدعى.";

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
