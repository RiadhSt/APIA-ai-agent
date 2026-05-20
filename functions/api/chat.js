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

    // =========================================================================
    // حقن قاعدة المعطيات القانونية والمالية التفصيلية لوكالة APIA مباشرة لحماية الذاكرة
    // =========================================================================
    const systemInstruction = `
أنت الخبير الافتراضي الذكي المعتمد لـ "وكالة النهوض بالاستثمارات الفلاحية" (APIA). مهمتك تقديم إجابات دقيقة وصارمة للغاية بناءً على الضوابط الرسمية التالية:

1. الامتيازات المالية والمنح (قانون الاستثمار التونسي):
- منحة التنمية الجهوية: تمنح للمشاريع في مناطق التنمية الجهوية: المجموعة الأولى بنسبة 15% بحد أقصى 1.5 مليون دينار، والمجموعة الثانية بنسبة 30% بحد أقصى 3 ملايين دينار.
- منحة التنمية المستدامة: بنسبة 50% بحد أقصى 0.3 مليون دينار لمشاريع معالجة التلوث، الاقتصاد في مياه الري، والفلاحة البيولوجية (تصل إلى 60% وبحد أقصى 0.5 مليون دينار للشركات الأهلية).
- التحكم في التكنولوجيا الحديثة وتحسين الإنتاجية: منحة بنسبة 50% بحد أقصى 0.5 مليون دينار لتطوير الآليات والإنتاج.
- دعم الشركات الأهلية: منحة تأطير وتسيير شهرياً بحد أقصى 800 دينار لمدة أقصاها 12 شهراً خلال السنوات الثلاث الأولى من النشاط.
- تشغيل حاملي الشهادات العليا: تتكفل الدولة بنسبة المساهمة في الضمان الاجتماعي، أو 50% من الأجور بحد أقصى 250 ديناراً شهرياً لمدة من سنة إلى 3 سنوات (تصل لـ 10 سنوات حسب النشاط والمنطقة).
- سلف الدراسات والمرافقة: بحد أقصى 20 ألف دينار للتأطير وشهادات المطابقة وتطوير منتجات جديدة للأصناف (أ، ب، ج).

2. القروض الفلاحية العقارية:
- الغرض: تمويل اقتناء الأراضي الفلاحية لإقامة مشاريع استثمارية منتجة ومجدية اقتصادياً.
- الشروط المالية: السقف الأقصى لتمويل القرض العقاري الفلاحي هو 250 ألف دينار (بشرط أن يكون الحد الأدنى لاقتناء الأرض من الأصول 125 ألف دينار).
- مدة السداد والإمهال: يسدد على مدى فترة تصل إلى 25 سنة، مع فترة إمهال تصل إلى 7 سنوات كاملة، بنسبة فائدة تفاضلية منخفضة تبلغ 3%.
- الفئة المستهدفة: الفلاحون، الباعثون الشبان، وحاملو الشهادات العليا في الفلاحة والصيد البحري.

3. القواعد العامة الصارمة في صياغة الإجابات:
- استخدم الجداول المنظمة بشكل احترافي عند عرض الأرقام، النسب المئوية، والمبالغ المالية (بالدينار التونسي).
- الالتزام الصارم بعدم تبسيط المحتوى الفني، ولا تقم باختصار الفقرات أو دمج الإجراءات القانونية. حافظ على النص الهيكلي كما هو بدون تغيير أي حرف أو رقم.
- إذا كان السؤال خارج نطاق المعطيات أعلاه أو يتطلب تفاصيل تشغيلية عينية، وجّه المستخدم بلطف للاتصال بالبريد الرسمي للمرافقة الشخصية: kouki.riadh@apia.com.tn
`;

    const currentContent = { role: "user", parts: [{ text: message }] };
    
    // الاحتفاظ بآخر حوارين فقط لحماية حجم الـ Payload من التضخم المفرط في المتصفح
    const trimmedHistory = history ? history.slice(-2) : [];
    const contents = [...trimmedHistory, currentContent];
    
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    // ===== منطق إعادة المحاولة الذكي (Retry with Exponential Backoff) =====
    const MAX_RETRIES = 3;
    let lastError = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(geminiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: contents,
            systemInstruction: { parts: [{ text: systemInstruction }] }
          })
        });

        const data = await response.json();

        // في حالة وجود ضغط أو خادم مشغول (429 أو 503)، نطبق منطق الانتظار التضاعفي
        if (!response.ok && (response.status === 429 || response.status === 503)) {
          lastError = data.error?.message || "الخادم مشغول حالياً";
          
          if (attempt < MAX_RETRIES) {
            // انتظار تصاعدي: 2 ثانية ← 4 ثوانٍ ← 8 ثوانٍ
            const delay = Math.pow(2, attempt + 1) * 1000;
            await new Promise(resolve => setTimeout(resolve, delay));
            continue; 
          }
          
          return new Response(JSON.stringify({ 
            error: "النموذج يواجه ضغطاً مرتفعاً جداً حالياً، يرجى المحاولة مرة أخرى بعد ثوانٍ قليلة." 
          }), {
            status: response.status,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        // أي خطأ آخر خارج نطاق الضغط العالي
        if (!response.ok) {
          return new Response(JSON.stringify({ error: data.error?.message || "خطأ داخلي من سيرفر جوجل" }), {
            status: response.status,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        // نجاح العملية وإرسال الرد
        const botReply = data.candidates?.[0]?.content?.parts?.[0]?.text || "لم أتمكن من صياغة إجابة.";
        return new Response(JSON.stringify({ reply: botReply }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });

      } catch (fetchError) {
        lastError = fetchError;
        if (attempt < MAX_RETRIES) {
          const delay = Math.pow(2, attempt + 1) * 1000;
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
      }
    }

    return new Response(JSON.stringify({ 
      error: "تعذر معالجة الطلب بعد عدة محاولات بسبب جدار الحماية أو شبكة الاتصال." 
    }), {
      status: 503,
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
