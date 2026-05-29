import { myKnowledgeBase, generalKnowledge, investmentKnowledge, developmentKnowledge } from './knowledge_split.js';

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
      return new Response(JSON.stringify({ error: "مفتاح GEMINI_API_KEY مفقود في الإعدادات!" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const safeHistory = (history || []).map(turn => ({
      role: turn.role === "assistant" ? "model" : turn.role,
      parts: (typeof turn.parts === "string") ? [{ text: turn.parts }] : turn.parts
    }));

    // ==========================================
    // 1. التوجيه البرمجي الفوري عبر الكلمات المفتاحية
    // ==========================================
    const lowerMessage = message.toLowerCase();
    let selectedKnowledge = "";

    const investmentKeywords = [
      'منحة', 'منح', 'امتياز', 'امتيازات', 'حوافز', 'تمويل', 'قرض', 'قروض', 'تشجيع', 'مالية', 'مالي',
      'subvention', 'subventions', 'avantage', 'avantages', 'prime', 'primes', 'financier', 'financiere', 'incitation'
    ];

    const developmentKeywords = [
      'تربية', 'الأحياء', 'المائية', 'سمك', 'أسماك', 'صيد', 'بحري', 'أحياء', 'زيت', 'زيتون', 'صادرات', 'تنمية', 'قطاع', 'قطاعات', 'مشروع', 'مشاريع',
      'aquaculture', 'pêche', 'poisson', 'huile', 'olive', 'export', 'développement', 'projet', 'projets', 'secteur'
    ];

    const hasInvestment = investmentKeywords.some(keyword => lowerMessage.includes(keyword));
    const hasDevelopment = developmentKeywords.some(keyword => lowerMessage.includes(keyword));

    if (hasInvestment && hasDevelopment) {
      selectedKnowledge = myKnowledgeBase;
    } else if (hasInvestment) {
      selectedKnowledge = `${generalKnowledge}\n\n=== INVESTMENT & GRANTS DETAILED CONTEXT ===\n\n${investmentKnowledge}`;
    } else if (hasDevelopment) {
      selectedKnowledge = `${generalKnowledge}\n\n=== DEVELOPMENTAL ACTIVITIES DETAILED CONTEXT ===\n\n${developmentKnowledge}`;
    } else {
      selectedKnowledge = myKnowledgeBase;
    }

    const systemInstruction = `You are the official Smart Assistant for the Agricultural Investment Promotion Agency (APIA) in Tunisia.
CRITICAL RULES:
1. LANGUAGE MATCH: Reply in the same language as the user query (Arabic or French or English). Never mix languages.
2. STRICT CONTEXT FOCUS: Answer ONLY the specific topic raised in the user's question. Provide all technical figures, percentages, and steps related exclusively to that topic. NEVER drift into other types of grants, secondary regulations, or unrelated laws unless the user explicitly asks for them.
3. CONCISE YET POWERFUL: Be highly direct, official, and professional. Avoid introductory filler, extra prose, or general overviews. Deliver the required exact data immediately.
4. MARKDOWN TABLES: Format numbers, percentages, and financial grants exclusively in clear Markdown tables.

OFFICIAL DIRECTORY DATABASE:
<knowledge_base>
${selectedKnowledge}
</knowledge_base>`;

    const contents = [...safeHistory, { role: "user", parts: [{ text: message }] }];
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    // ==========================================
    // 2. آلية التكرار التلقائي الذكية لحل مشكلة الضغط اللحظي
    // ==========================================
    let response;
    let attempts = 0;
    const maxAttempts = 3; // عدد محاولات إعادة الإرسال تلقائياً
    const delay = (ms) => new Promise(res => setTimeout(res, ms));

    while (attempts < maxAttempts) {
      response = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: contents,
          systemInstruction: { parts: [{ text: systemInstruction }] },
          generationConfig: { temperature: 0.2, topP: 0.95 }
        })
      });

      // إذا نجح الاتصال والسيرفر أجاب بشكل صحيح، نخرج من الحلقة فوراً
      if (response.ok) break;

      const errorData = await response.clone().json().catch(() => ({}));
      const errorMsg = errorData.error?.message || "";

      // إذا كان الخطأ بسبب الضغط اللحظي (كود 429 أو 503 أو جملة High Demand)
      if (response.status === 429 || response.status === 503 || errorMsg.toLowerCase().includes("high demand")) {
        attempts++;
        if (attempts < maxAttempts) {
          // الانتظار لفترة تزداد تدريجياً بين المحاولات (مثلاً 400 ملي ثانية ثم 800 ملي ثانية) لتخفيف الضغط
          await delay(400 * attempts); 
          continue; // إعادة المحاولة
        }
      } else {
        // إذا كان خطأ آخر مختلف ودائم (مثل مفتاح خطأ)، نخرج دون تكرار
        break;
      }
    }

    // ==========================================
    // 3. معالجة النتيجة النهائية وحجب رسائل جوجل المزعجة
    // ==========================================
    if (!response.ok) {
      // حجب رسالة جوجل بالإنجليزية واستبدالها برسالة إدارية تعريبية محترفة تناسب هوية الوكالة
      const friendlyError = "المنصة تقوم بمعالجة حجم بيانات ضخم حالياً لتوفير إجابة دقيقة ومكتملة. يرجى إعادة الضغط على زر الإرسال خلال 3 ثوانٍ لتأكيد طلبك.\n\nL'infrastructure traite actuellement un volume important de données. Veuillez cliquer à nouveau sur le bouton d'envoi dans 3 secondes.";
      return new Response(JSON.stringify({ error: friendlyError }), {
        status: response.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const data = await response.json();
    const candidate = data.candidates?.[0];
    let botReply = "";

    if (candidate && candidate.content && candidate.content.parts) {
      botReply = candidate.content.parts.map(part => part.text).join("\n");
    }

    if (!botReply) {
      botReply = "المنصة قيد التحديث اللحظي، الرجاء إعادة صياغة السؤال ولكم جزيل الشكر.";
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
