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
      return new Response(JSON.stringify({ error: "مفتاح الـ GEMINI_API_KEY مفقود!" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const safeHistory = (history || []).map(turn => ({
      role: turn.role === "assistant" ? "model" : turn.role,
      parts: (typeof turn.parts === "string") ? [{ text: turn.parts }] : turn.parts
    }));

    // ==========================================
    // المرحلة الأولى: التوجيه البرمجي الفوري (0 ملي ثانية)
    // ==========================================
    const lowerMessage = message.toLowerCase();
    let selectedKnowledge = "";

    // 1. الكلمات المفتاحية لقسم الاستثمار والمنح (بالعربية والفرنسية)
    const investmentKeywords = [
      'منحة', 'منح', 'امتياز', 'امتيازات', 'حوافز', 'تمويل', 'قرض', 'قروض', 'تشجيع', 'مالية', 'مالي',
      'subvention', 'subventions', 'avantage', 'avantages', 'prime', 'primes', 'financier', 'financiere', 'incitation'
    ];

    // 2. الكلمات المفتاحية لقسم الأنشطة التنموية والقطاعات
    const developmentKeywords = [
      'تربية', 'الأحياء', 'المائية', 'سمك', 'أسماك', 'صيد', 'بحري', 'أحياء', 'زيت', 'زيتون', 'صادرات', 'تنمية', 'قطاع', 'قطاعات', 'مشروع', 'مشاريع',
      'aquaculture', 'pêche', 'poisson', 'huile', 'olive', 'export', 'développement', 'projet', 'projets', 'secteur'
    ];

    // فحص السؤال برمجياً لحقن السياق التراكمي المناسب فوراً
    const hasInvestment = investmentKeywords.some(keyword => lowerMessage.includes(keyword));
    const hasDevelopment = developmentKeywords.some(keyword => lowerMessage.includes(keyword));

    if (hasInvestment && hasDevelopment) {
      // إذا كان السؤال يدمج الشقين معاً، نشحن الملف الشامل كاملاً لضمان الدقة
      selectedKnowledge = myKnowledgeBase;
    } else if (hasInvestment) {
      // شحن القوانين العامة + تفاصيل المنح والمالية
      selectedKnowledge = `${generalKnowledge}\n\n=== INVESTMENT & GRANTS DETAILED CONTEXT ===\n\n${investmentKnowledge}`;
    } else if (hasDevelopment) {
      // شحن القوانين العامة + تفاصيل القطاعات الفلاحية والتنموية
      selectedKnowledge = `${generalKnowledge}\n\n=== DEVELOPMENTAL ACTIVITIES DETAILED CONTEXT ===\n\n${developmentKnowledge}`;
    } else {
      // الافتراضي الذكي عند عدم مطابقة الكلمات: نفتح الملف الشامل احتياطاً لمنع النقصان
      selectedKnowledge = myKnowledgeBase;
    }

    // ==========================================
    // المرحلة الثانية: بناء الأمر الفردي المباشر لـ Gemini
    // ==========================================
    const systemInstruction = `You are the official Smart Assistant for the Agricultural Investment Promotion Agency (APIA) in Tunisia.

CRITICAL RULES:
1. LANGUAGE MATCH: Detect the user's input language. If the user asks in French, reply in French. If in Arabic, reply in Arabic. If in English, reply in straightforward, professional English using standard business terms. NEVER mix languages.
2. MARKDOWN TABLES: Format ALL numbers, percentages, and financial grants exclusively in clear Markdown tables. Do not write numbers in raw text.
3. NO SOURCE MENTION: Reply directly as an official expert. Never say "according to the file" or "in the database".
4. COMPLETENESS: Provide full administrative steps, percentages, and legal conditions in maximum detail without any abbreviation.

OFFICIAL DIRECTORY DATABASE:
<knowledge_base>
${selectedKnowledge}
</knowledge_base>`;

    const contents = [
      ...safeHistory,
      { role: "user", parts: [{ text: message }] }
    ];

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    // إرسال طلب واحد مباشر (سريع جداً وموفر للطاقة الحسابية)
    const response = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: contents,
        systemInstruction: { parts: [{ text: systemInstruction }] },
        generationConfig: {
          temperature: 0.0, // صفر لسرعة وثبات الصياغة اللغوية والجداول
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
