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
    
    // التأكد من صياغة الاسم بالكامل وبشكل صلب لحل مشكلة الـ Parsing نهائياً
    const cacheName = "cachedContents/8ifnvtga4d30om4mbzm8mphbkrzyy11cdcfd2jz";

    if (!apiKey) {
      return new Response(JSON.stringify({ error: "مفتاح الـ GEMINI_API_KEY مفقود!" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // ترتيب السجل متوافقاً مع صيغة Gemini
    const safeHistory = (history || []).map(turn => ({
      role: turn.role === "assistant" ? "model" : turn.role,
      parts: (typeof turn.parts === "string") ? [{ text: turn.parts }] : turn.parts
    }));

    // دمج التوجيهات الصارمة لـ APIA مع سؤال المستخدم مباشرة لتفادي خطأ الـ systemInstruction
    const contents = [
      ...safeHistory,
      {
        role: "user",
        parts: [
          { 
            text: `توجيهات مؤسساتية صارمة: أنت الخبير القانوني والمالي لوكالة النهوض بالاستثمارات الفلاحية (APIA). أجب بدقة وتفصيل شديد وغزارة في المعلومات بناءً على قاعدة المعرفة المخزنة في الكاش الخاص بك. التزم تماماً بلغة المستخدم واستخدم جداول الماركداون للتنظيم المالي بوضوح.\n\nسؤال المستخدم الحالي هو: ${message}` 
          }
        ]
      }
    ];

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    // هنا التعديل الجوهري: نرسل الكائن بالصيغة الهيكلية التي يتوقعها محرك v1beta
    const response = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: contents,
        // إضافة الكائن الموجه للـ cache لتتعرف عليه خوادم جوجل فوراً دون لبس
        cachedContent: cacheName,
        generationConfig: {
          temperature: 0.1,
          topP: 0.95
        }
      })
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      return new Response(JSON.stringify({ error: data.error?.message || "خطأ في معالجة طلب الكاش" }), {
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

    if (!botReply) botReply = "لم أتمكن من صياغة إجابة من الكاش.";

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
