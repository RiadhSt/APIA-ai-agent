import { myKnowledgeBase } from './knowledge.js';

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

    // تنظيف وتجهيز الـ History مع ضمان تحويل الـ parts إلى مصفوفة لتجنب أخطاء البنية
    const safeHistory = (history || []).map(turn => ({
      role: turn.role === "assistant" ? "model" : turn.role,
      parts: (typeof turn.parts === "string") ? [{ text: turn.parts }] : turn.parts
    }));

    const attachedFilesParts = [];

    // وضع القواعد في القمة (Top-Priority) وقاعدة البيانات في الأسفل لحل مشكلة التشتت
    const systemInstruction = `أنت المساعد الذكي لوكالة النهوض بالاستثمارات الفلاحية (APIA).

قواعد تشغيلية حاسمة وصارمة (تُطبق قبل قراءة قاعدة المعرفة):
1. الالتزام المطلق بلغة السؤال: احرص على كشف لغة المستخدم بدقة. إذا سأل بالإنجليزية أجب بالإنجليزية، بالفرنسية أجب بالفرنسية، بالعربية أجب بالعربية. يُمنع تماماً الرد بلغة مغايرة أو خلط اللغات.
2. التنسيق الإجباري للجداول: يُمنع منعاً باتاً سرد الأرقام، النسب المئوية، المبالغ المالية، أو المنح داخل نصوص إنشائية متصلة. يجب عليك دائماً صياغتها وعرضها في جداول ماركداون (Markdown Tables) واضحة، محاذية، ومكتوبة بنفس لغة السؤال.
3. غزارة وتفصيل المعلومات: اسرد الشروط القانونية، النسب، والخطوات الإدارية كاملة وبأقصى تفصيل ممكن دون أي اختصار مخل وبأعلى درجة من الأمانة للمحتوى الرقمي الأصلي.
4. إدارة تضارب السياق (أولوية المعلومة): اعتمد دائماً التفاصيل الشاملة المتوفرة في الأقسام الهيكلية داخل قاعدة المعرفة، واستخدم قسم الأسئلة الشائعة كمؤشر فقط.
5. منع ذكر المصادر: لا تشر إلى وجود قاعدة معرفة أو ملف مرفق، قدم المعلومة مباشرة كمساعد رسمي في الوكالة.

مصدر معلوماتك الحصري والوحيد لاعتماده حرفياً دون أي تغيير في النسب أو الأرقام:
<knowledge_base>
${myKnowledgeBase}
</knowledge_base>
`;    

    const contents = [
      ...safeHistory,
      { 
        role: "user", 
        parts: [
          ...attachedFilesParts,
          { text: message }
        ] 
      }
    ];

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const response = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: contents,
        systemInstruction: { parts: [{ text: systemInstruction }] },
        generationConfig: {
          temperature: 0.0, // صفر تلاعب لمنع تغيير اللغة وإجبار تنسيق الجداول الرياضي ثنائي الأبعاد
          topP: 0.95
        }
      })
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      return new Response(JSON.stringify({ error: data.error?.message || "خطأ من سيرفر جوجل" }), {
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

    if (!botReply) {
      botReply = "لم أتمكن من صياغة إجابة.";
    }
    
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
