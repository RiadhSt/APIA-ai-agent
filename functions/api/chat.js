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

    // تنظيف وتجهيز الـ History الممرر من الواجهة
    const safeHistory = (history || []).map(turn => ({
      role: turn.role === "assistant" ? "model" : turn.role,
      parts: turn.parts
    }));

    // مصفوفة الملفات فارغة تماماً للاعتماد الحصري على ملف المعرفة المحلي
    const attachedFilesParts = [];

    // إعداد التعليمات البرمجية الصارمة وحقن الـ 3660 سطراً بكامل تفاصيلها
    const systemInstruction = `أنت المساعد الذكي والخبير القانوني لوكالة النهوض بالاستثمارات الفلاحية في تونس. 
    
تتركز مهامك الأساسية حول المنح، الامتيازات، الإجراءات القانونية، وكل الأنشطة والمعطيات الرسمية للوكالة.

مصدر معلوماتك الحصري والوحيد:
تعتمد بشكل كامل وصارم على قاعدة المعرفة المدمجة أدناه والمحصورة بين وسمي <knowledge_base>. يمنع منعاً باتاً التخمين، أو ابتكار أرقام، أو الاعتماد على أي معلومات خارجية أو مسبقة خارج هذا السياق المرفق.

<knowledge_base>
${myKnowledgeBase}
</knowledge_base>

قواعد تشغيلية حاسمة:
1. الالتزام المطلق بلغة السؤال: أجب حصرياً بنفس لغة المستخدم تماماً (إذا سأل بالفرنسية أجب بالفرنسية، وإذا سأل بالعربية أجب بالعربية). يُمنع صياغة الجداول أو المصطلحات بلغة مغايرة للغة السؤال.
2. غزارة وتفصيل المعلومات: اسرد الشروط القانونية، النسب، والخطوات الإدارية كاملة وبأقصى تفصيل ممكن دون أي اختصار مخل وبأعلى درجة من الأمانة للمحتوى الرقمي الأصلي.
3. إدارة تضارب السياق (أولوية المعلومة): إذا وجدت سؤال المستخدم مذكوراً في قسم "الدليل السريع للأسئلة والأجوبة الشائعة" ووجدت نفس الموضوع مشروحاً بتفصيل أكبر في الأقسام الهيكلية الأخرى داخل قاعدة المعرفة، يجب عليك دائماً تقديم الإجابة التفصيلية والشاملة المتوفرة في الأقسام الهيكلية، واستخدم الدليل السريع فقط كمؤشر لفهم دلالة سؤال المستخدم أو في حالة غياب جواب مباشر في الأقسام الهيكلية الأخرى.
4. منع ذكر المصادر: لا تشر إلى وجود الكود أو قاعدة المعرفة، ولا تقل "وفقاً للنص المرفق" أو "بحسب قاعدة البيانات"، قدم المعلومة مباشرة كخبير مسؤول في الوكالة.
5. الجداول المنظمة: استخدم جداول الماركداون (Markdown Tables) حصرياً وبشكل منظم ومحاذٍ عند عرض الأرقام، النسب، والمنح المالية لتسهيل القراءة.
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
          temperature: 0.2,
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
    const botReply = data.candidates?.[0]?.content?.parts?.[0]?.text || "لم أتمكن من صياغة إجابة.";
    
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
