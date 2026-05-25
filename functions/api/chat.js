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

    // 1. تنظيف وتجهيز الـ History الممرر
    const safeHistory = (history || []).map(turn => ({
      role: turn.role === "assistant" ? "model" : turn.role,
      parts: turn.parts
    }));

    // 2. إعداد تعليمات النظام (أصبحت خفيفة وقصيرة لسرعة المعالجة)
    const systemInstruction = `أنت المساعد الذكي والخبير القانوني لوكالة النهوض بالاستثمارات الفلاحية في تونس (APIA).
تعتمد بشكل كامل وصارم على قاعدة المعرفة الممررة إليك في سياق المحادثة تحت وسم <knowledge_base>. يمنع منعاً باتاً التخمين أو ابتكار أرقام خارج هذا السياق.

قواعد حاسمة:
1. أجب حصرياً بنفس لغة المستخدم (عربي أو فرنسي).
2. اسرد الشروط والنسب كاملة وبأقصى تفصيل دون أي اختصار مخل.
3. لا تذكر مصادرك أو كلمة "قاعدة المعرفة"، قدم المعلومة مباشرة كخبير مسؤول.
4. استخدم جداول الماركداون (Markdown Tables) عند عرض الأرقام والمنح.`;

    // 3. الهيكلة الذكية للـ Contents (حقن المعرفة كرسالة مستخدم أولى)
    const contents = [];

    // إذا كانت المحادثة جديدة، نلقم المعرفة في البداية فوراً ليتذكرها النظام
    if (safeHistory.length === 0) {
      contents.push({
        role: "user",
        parts: [{ text: `إليك قاعدة المعرفة الرسمية والخاصة بالوكالة، قم بحفظها وفهمها بدقة للإجابة منها لاحقاً:\n<knowledge_base>\n${myKnowledgeBase}\n</knowledge_base>` }]
      });
      contents.push({
        role: "model",
        parts: [{ text: "مفهوم تماماً. لقد قمت بحفظ قاعدة المعرفة والامتيازات الجبائية والمالية لوكالة APIA بالكامل، وأنا جاهز للإجابة على استفسارات المستخدمين بدقة وتفصيل." }]
      });
    } else {
      // إذا كان هناك تاريخ سابق للمحادثة، ندمج التاريخ مباشرة
      contents.push(...safeHistory);
    }

    // إضافة سؤال المستخدم الحالي في نهاية المصفوفة
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
        systemInstruction: { parts: [{ text: systemInstruction }] },
        generationConfig: {
          temperature: 0.1, // تقليل التشتت لزيادة السرعة والدقة
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
