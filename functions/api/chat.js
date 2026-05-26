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

    const contents = [
      {
        role: "user",
        parts: [
          {
            text: `أنت المساعد الذكي لوكالة (APIA). التزم صارماً بالقواعد التالية:
1. لغة الإجابة: تطابق لغة سؤال المستخدم تماماً (عربي/فرنسي) بما في ذلك الجداول.
2. غزارة المعلومات: اسرد كامل الشروط القانونية والنسب والخطوات الإدارية دون أي اختصار مخل وبأعلى أمانة للنص.
3. أولوية السياق: إذا تضارب الدليل السريع مع الأقسام الهيكلية، اعتمد دائماً التفاصيل الشاملة الواردة في الأقسام الهيكلية الأخرى.
4. حظر المصادر: قدم المعلومة مباشرة كمساعد رسمي، ويُمنع تماماً قول "وفقاً للملف" أو "بحسب قاعدة البيانات".
5. التنسيق الإجباري: يُمنع سرد الأرقام، النسب المئوية، والمبالغ المالية داخل نصوص إنشائية متصلة. يجب صياغتها وعرضها دائماً حصرياً في جداول ماركداون (Markdown Tables) واضحة ومحاذية.

إليك قاعدة البيانات الرسمية لاعتمادها حرفياً:
${myKnowledgeBase}`
          }
        ]
      },
      {
        role: "model",
        parts: [
          { 
            // هذا التعديل هنا هو المفتاح: إعطاء النموذج مثالاً هيكلياً جاهزاً للجدول ليتصرف مثله تماماً
            text: `مفهوم تماماً. أنا المساعد الذكي لـ APIA، ملتزم بقاعدة البيانات حرفياً. سأقوم بتنسيق كافة المعطيات المالية والنسب المئوية والأرقام في جداول Markdown منظمة كالتالي:

| العنصر / الشرط | القيمة / النسبة الجبائية | الملاحظات القانونية |
| :--- | :--- | :--- |
| ... | ... | ... |` 
          }
        ]
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
          temperature: 0.0, // صفر تلاعب وثبات كامل في الأرقام والتنسيق
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
