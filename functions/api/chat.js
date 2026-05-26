// استيراد الملف الشامل بالإضافة إلى الملفات المقسمة (تأكد من مطابقة المسميات والمسارات لديك)
import { myKnowledgeBase, generalKnowledge, investmentKnowledge, developmentKnowledge } from './knowledge_split.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  // معالجة طلبات الـ Preflight لـ CORS
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

    // تنظيف وتجهيز الـ History الممرر من الواجهة آمن لجميع أنواع البيانات
    const safeHistory = (history || []).map(turn => ({
      role: turn.role === "assistant" ? "model" : turn.role,
      parts: (typeof turn.parts === "string") ? [{ text: turn.parts }] : turn.parts
    }));

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    // ==========================================
    // المرحلة الأولى: التوجيه الذكي (Routing Stage)
    // ==========================================
    const routingInstruction = `Analyze the user query and classify it into exactly ONE of these categories based on keywords and context:
- "GENERAL": For general info about APIA, administrative steps, laws, or non-specific text.
- "INVESTMENT": For topics about financial grants (subventions), benefits (avantages), incentives, and investments.
- "DEVELOPMENT": For developmental activities, agriculture sectors, aquaculture, and specific projects.
- "KNOWLEDGE": Use this ONLY as a last resort if the question is highly complex, combines multiple categories at once (e.g., asking about grants AND development sectors together), or is too vague to split.

Output only the single word: GENERAL, INVESTMENT, DEVELOPMENT, or KNOWLEDGE. Do not add punctuation or explanation.`;

    const routingResponse = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: `Query: ${message}` }] }],
        systemInstruction: { parts: [{ text: routingInstruction }] },
        generationConfig: { temperature: 0.0 } // صفر لمنع التخمين العشوائي للفئة
      })
    });

    let category = "GENERAL"; // القيمة الافتراضية الاقتصادية الآمنة
    if (routingResponse.ok) {
      const routingData = await routingResponse.json();
      const rawCategory = routingData.candidates?.[0]?.content?.parts?.[0]?.text || "GENERAL";
      category = rawCategory.trim().toUpperCase();
    }

    // ==========================================
    // المرحلة الثانية: تحميل الملف ديناميكياً (التوجيه الهرمي)
    // ==========================================
    let selectedKnowledge = generalKnowledge; // الافتراضي الأول

    if (category.includes("INVESTMENT")) {
      selectedKnowledge = investmentKnowledge;
    } else if (category.includes("DEVELOPMENT")) {
      selectedKnowledge = developmentKnowledge;
    } else if (category.includes("KNOWLEDGE") || category.includes("GENERAL") === false) {
      // ملجأ الأمان الأخير: إذا احتار الموديل أو طلب الملف الكامل، يتم شحن قاعدة البيانات الشاملة
      selectedKnowledge = myKnowledgeBase;
    }

    // بناء الـ System Instruction بالملف المختار ديناميكياً
    const systemInstruction = `You are the official Smart Assistant for the Agricultural Investment Promotion Agency (APIA) in Tunisia.

CRITICAL RULES:
1. LANGUAGE MATCH: Detect the user's input language. If the user asks in French, reply in French. If in Arabic, reply in Arabic. If in English, reply in straightforward, professional English using standard business and investment terms. NEVER mix languages.
2. MARKDOWN TABLES: Format ALL numbers, percentages, and financial grants exclusively in clear Markdown tables. Do not write numbers in raw text.
3. NO SOURCE MENTION: Reply directly as an official expert. Never say "according to the file" or "in the database".
4. COMPLETENESS: Provide full administrative steps, percentages, and legal conditions in maximum detail without any abbreviation based on the current context.

OFFICIAL DIRECTORY DATABASE (TEMPORARY CONTEXT):
<knowledge_base>
${selectedKnowledge}
</knowledge_base>`;

    // ==========================================
    // المرحلة الثالثة: توليد الإجابة النهائية النظيفة
    // ==========================================
    const contents = [
      ...safeHistory,
      { role: "user", parts: [{ text: message }] }
    ];

    const response = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: contents,
        systemInstruction: { parts: [{ text: systemInstruction }] },
        generationConfig: {
          temperature: 0.2, // مرونة ضئيلة جداً لصياغة جداول الماركداون والترجمة باحترافية
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
        .filter(part => !part.thought && part.text) // استبعاد التفكير الداخلي
        .map(part => part.text);
        
      botReply = textParts.join("\n");
    }

    // التنظيف الآمن للنصوص لجميع اللغات (عربي/فرنسي/إنجليزي) لمنع تجميد أو كراش الواجهة
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
