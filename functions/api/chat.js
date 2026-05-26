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

    // بناء السياق مع تحديد هوية المساعد الذكي والقواعد التشغيلية
    const contents = [
      {
        role: "user",
        parts: [
          {
            text: `أنت المساعد الذكي لوكالة النهوض بالاستثمارات الفلاحية (APIA).

قواعد تشغيلية حاسمة يجب تطبيقها بصرامة مطلقة:
1. الالتزام المطلق بلغة السؤال: أجب حصرياً بنفس لغة المستخدم تماماً (إذا سأل بالفرنسية أجب بالفرنسية، وإذا سأل بالعربية أجب بالعربية). يُمنع صياغة الجداول أو المصطلحات بلغة مغايرة للغة السؤال.
2. غزارة وتفصيل المعلومات: اسرد الشروط القانونية، النسب، والخطوات الإدارية كاملة وبأقصى تفصيل ممكن دون أي اختصار مخل وبأعلى درجة من الأمانة للمحتوى الرقمي الأصلي.
3. إدارة تضارب السياق (أولوية المعلومة): إذا وجدت سؤال المستخدم مذكوراً في قسم "الدليل السريع للأسئلة والأجوبة الشائعة" ووجدت نفس الموضوع مشروحاً بتفصيل أكبر في الأقسام الهيكلية الأخرى داخل قاعدة المعرفة، يجب عليك دائماً تقديم الإجابة التفصيلية والشاملة المتوفرة في الأقسام الهيكلية، واستخدم الدليل السريع فقط كمؤشر لفهم دلالة سؤال المستخدم أو في حالة غياب جواب مباشر في الأقسام الهيكلية الأخرى.
4. منع ذكر المصادر: لا تشر إلى وجود الكود أو قاعدة المعرفة، ولا تقل "وفقاً للنص المرفق" أو "بحسب قاعدة البيانات"، قدم المعلومة مباشرة كمساعد ذكي مسؤول في الوكالة.
5. الجداول المنظمة: استخدم جداول الماركداون (Markdown Tables) حصرياً وبشكل منظم ومحاذٍ عند عرض الأرقام، النسب، والمنح المالية لتسهيل القراءة.

إليك قاعدة البيانات القانونية والجبائية الرسمية والشاملة للوكالة للاعتماد عليها حرفياً:

${myKnowledgeBase}`
          }
        ]
      },
      {
        role: "model",
        parts: [{ text: "مفهوم تماماً ومُلتزم بالاتساق الصارم. أنا الآن بصفتي المساعد الذكي لـ APIA، سأقوم بتطبيق كافة القواعد التشغيلية الخمس بصرامة، متبنيّاً لغة المستخدم بالكامل، مع تقديم أقصى تفصيل للمعلومات والنسب والجداول المنظمة دون الإشارة إلى أي مصادر خارجية." }]
      }
    ];

    // دمج سجل المحادثة السابق إن وجد
    if (history && history.length > 0) {
      history.forEach(turn => {
        contents.push({
          role: turn.role === "assistant" ? "model" : turn.role,
          parts: (typeof turn.parts === "string") ? [{ text: turn.parts }] : turn.parts
        });
      });
    }

    // إضافة سؤال المستخدم الحالي بنهاية السياق
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
          temperature: 0.1,
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
