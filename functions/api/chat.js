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
1. الالتزام المطلق بلغة السؤال: أجب حصرياً بنفس لغة المستخدم تماماً (إذا سأل بالفرنسية أجب بالفرنسية، وإذا سأل بالعربية أجب بالعربية، وإذا سأل بالإنجليزية أجب بالإنجليزية). يُمنع صياغة الجداول أو المصطلحات بلغة مغايرة للغة السؤال.
2. غزارة وتفصيل المعلومات: اسرد الشروط القانونية، النسب، والخطوات الإدارية كاملة وبأقصى تفصيل ممكن دون أي اختصار مخل وبأعلى درجة من الأمانة للمحتوى الرقمي الأصلي.
3. إدارة تضارب السياق (أولوية المعلومة): إذا وجدت سؤال المستخدم مذكوراً في قسم "الدليل السريع للأسئلة والأجوبة الشائعة" ووجدت نفس الموضوع مشروحاً بتفصيل أكبر في الأقسام الهيكلية الأخرى داخل قاعدة المعرفة، يجب عليك دائماً تقديم الإجابة التفصيلية والشاملة المتوفرة في الأقسام الهيكلية، واستخدم الدليل السريع فقط كمؤشر لفهم دلالة سؤال المستخدم أو في حالة غياب جواب مباشر في الأقسام الهيكلية الأخرى.
4. منع ذكر المصادر: لا تشر إلى وجود الكود أو قاعدة المعرفة، ولا تقل "وفقاً للنص المرفق" أو "بحسب قاعدة البيانات"، قدم المعلومة مباشرة كخبير مسؤول في الوكالة.
5. الجداول المنظمة: استخدم جداول الماركداون (Markdown Tables) حصرياً وبشكل منظم ومحاذٍ عند عرض الأرقام، النسب، والمنح المالية لتسهيل القراءة.
`;    

    // تطبيق استراتيجية الترجمة على مرحلتين (بلورة المخرج بلغة المصدر أولاً ثم ترجمة الناتج النهائي فقط)
    const formattedMessage = `[CRITICAL INSTRUCTION / EXECUTION STAGE]:
1. Step 1 (Drafting): Search the <knowledge_base>, find the exact info, and draft the full detailed answer with all numbers and Markdown Tables in the language of the source text (Arabic or French).
2. Step 2 (Translation): Take that drafted answer and translate it completely to the exact language of the user's question below. Ensure that the Markdown tables and terms are perfectly translated into the user's language.

User Question: ${message}`;

    const contents = [
      ...safeHistory,
      { 
        role: "user", 
        parts: [
          ...attachedFilesParts,
          { text: formattedMessage } // هنا تم حقن الأمر الجديد لحل مشكلة اللغة
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
    const candidate = data.candidates?.[0];
    let botReply = "";

    if (candidate && candidate.content && candidate.content.parts) {
      const textParts = candidate.content.parts
        .filter(part => !part.thought && part.text) // تصفية الأجزاء النصية الموجهة للمستخدم واستبعاد أجزاء التفكير
        .map(part => part.text);
        
      botReply = textParts.join("\n");
    }

    // التنظيف الآمن والشامل لجميع اللغات (عربي/فرنسي/إنجليزي) لمنع كراش الواجهة الأمامية
    if (botReply.includes("THOUGHT:")) {
      const parts = botReply.split("THOUGHT:");
      botReply = parts[parts.length - 1].trim();
      
      if (botReply.includes("-->")) {
         const cleanParts = botReply.split("-->");
         botReply = cleanParts[cleanParts.length - 1].trim();
      }
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
