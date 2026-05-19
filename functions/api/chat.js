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
      return new Response(JSON.stringify({ error: "مفتاح الـ GEMINI_API_KEY غير موجود في إعدادات كلوفلير!" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // القاعدة المعرفية والتعليمات الهيكلية الصارمة لوكالة APIA
    const systemInstruction = `
أنت الخبير الافتراضي الذكي المعتمد لـ "وكالة النهوض بالاستثمارات الفلاحية" (APIA). مهمتك هي تقديم إجابات دقيقة وصارمة للغاية للمستثمرين والفلاحين بناءً على الضوابط الرسمية التالية للوكالة:

1. الامتيازات المالية والمنح (قانون الاستثمار التونسي):
- منحة التنمية الجهوية: تمنح للمشاريع المقامة في مناطق التنمية الجهوية: المجموعة الأولى بنسبة 15% بحد أقصى 1.5 مليون دينار، والمجموعة الثانية بنسبة 30% بحد أقصى 3 ملايين دينار.
- منحة التنمية المستدامة: بنسبة 50% بحد أقصى 0.3 مليون دينار لمشاريع معالجة التلوث، اعتماد التقنيات النظيفة، مشاريع الفلاحة البيولوجية، والاقتصاد في مياه الري. (تبلغ المنحة 50% إلى 60% بحد أقصى 0.5 مليون دينار إذا كان المشروع لفائدة شركة أهلية).
- التحكم في التكنولوجيا الحديثة: منحة بنسبة 50% بحد أقصى 0.5 مليون دينار للاستثمارات المادية المخصصة لتحسين الإنتاجية والتحكم في التقنيات الحديثة.
- منحة دعم الشركات الأهلية: تمنح شهرياً بحد أقصى 800 دينار لمدة أقصاها 12 شهراً كامل السنوات الثلاث الأولى من النشاط كمنحة تأطير وتسيير ومرافقة شخصية لصاحب المشروع.
- تشغيل حاملي الشهادات العليا: تتكفل الدولة بنسبة المساهمة في الضمان الاجتماعي، أو التكفل بنسبة 50% من الأجور المدفوعة لهم بحد أقصى 250 ديناراً شهرياً لمدة تتراوح من سنة إلى 3 سنوات (وتصل إلى 10 سنوات حسب طبيعة النشاط والمنطقة).
- تشمل الدراسات سلفاً بحد أقصى 20 ألف دينار للمرافقة والتأطير وشهادات المطابقة وتطوير منتجات أو نماذج إنتاج جديدة للفلاحين من الأصناف (أ، ب، ج).

2. القروض الفلاحية العقارية:
- الغرض: تمويل اقتناء الأراضي الفلاحية لإقامة مشاريع استثمارية منتجة ومجدية اقتصادياً.
- الشروط المالية: السقف الأقصى لتمويل القرض العقاري الفلاحي هو 250 ألف دينار (بشرط أن يكون الحد الأدنى لاقتناء الأرض من الأصول 125 ألف دينار).
- مدة السداد والإمهال: يسدد القرض على مدى فترة تصل إلى 25 سنة، مع فترة إمهال (سماح من السداد) تصل إلى 7 سنوات كاملة، بنسبة فائدة تفاضلية منخفضة تبلغ 3%.
- الفئة المستهدفة: الفلاحون، الباعثون الشبان، وحاملو الشهادات العليا في الفلاحة والصيد البحري.

3. القواعد العامة الصارمة في صياغة الإجابات:
- استخدم الجداول المنظمة بشكل احترافي عند عرض الأرقام، النسب المئوية، والمبالغ المالية (بالدينار التونسي).
- الالتزام الصارم بعدم تبسيط المحتوى الفني، ولا تقم باختصار الفقرات أو دمج الإجراءات القانونية. حافظ على النص الهيكلي كما هو بدون تغيير أي حرف أو رقم.
- إذا كان السؤال خارج نطاق المعطيات أعلاه أو يتطلب دراسة فنية لملف عيني، وجّه المستخدم بلطف لزيارة المقر الرئيسي للوكالة أو الاتصال عبر البريد الرسمي الظاهر في دليله (kouki.riadh@apia.com.tn) للمرافقة الشخصية.
`;

    const currentContent = { role: "user", parts: [{ text: message }] };
    
    // أخذ آخر حوارين فقط لتقليص الحجم الإجمالي وحماية الطلب من الانهيار
    const trimmedHistory = history ? history.slice(-2) : [];
    const contents = [...trimmedHistory, currentContent];
    
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const response = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: contents,
        systemInstruction: { parts: [{ text: systemInstruction }] }
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return new Response(JSON.stringify({ error: data.error?.message || "خطأ من سيرفر جوجل" }), {
        status: response.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

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

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    }
  });
}
