import { myKnowledgeBase } from "./knowledge.js";

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

    // السياق المباشر والسريع مع الدمج البصري للجداول
    const contents = [
      {
        role: "user",
        parts: [
          {
            text: `أنت المساعد الذكي لوكالة النهوض بالاستثمارات الفلاحية (APIA). 

قواعد تشغيلية صارمة:
1. الالتزام المطلق بلغة السؤال: أجب بنفس لغة المستخدم تماماً (عربي/فرنسي).
2. غزارة المعلومات: اسرد الشروط والنسب والخطوات كاملة وبأقصى تفصيل ممكن.
3. إدارة تضارب السياق: اعتمد دائماً الإجابة التفصيلية الشاملة المتوفرة في الأقسام الهيكلية بدلاً من الدليل السريع.
4. منع ذكر المصادر: قدم المعلومة مباشرة كمساعد رسمي دون قول "وفقاً للملف المرفق".
5. التنسيق الهيكلي (إجباري): قم بتحويل وتلخيص أي أرقام، مبالغ، نسب جبائية، أو منحة مالية واردة في النص أدناه وعرضها دائماً في جدول ماركداون (Markdown Table) منظم ومحاذٍ بدلاً من السرد النصي.

إليك قاعدة البيانات لاعتمادها حرفياً:
${myKnowledgeBase}`
          }
        ]
      },
      {
        role: "model",
        parts: [{ text: "مفهوم تماماً. أنا المساعد الذكي لـ APIA، سأعتمد على النص حرفياً وأعرض كافة الأرقام والنسب المئوية والمنح في جداول ماركداون (Markdown) منسقة تلقائياً." }]
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

    contents.push({
      role: "user",
      parts: [{ text: message }]
    });

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const response = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: contents,
        generationConfig: {
          temperature: 0.0, // الحفاظ على دقة الأرقام والنسب الرسمية بنسبة 100%
          topP: 0.95
        }
      })
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
