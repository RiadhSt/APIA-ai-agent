import { myKnowledgeBase } from './knowledge.js';

// ══════════════════════════════════════════════
//  RAG خفيف: استخراج الـ topics ذات الصلة فقط
// ══════════════════════════════════════════════

// 1. تقسيم قاعدة المعرفة إلى topics عند أول تحميل (مرة واحدة فقط)
const TOPICS = (() => {
  const regex = /<topic\s+name="([^"]+)">([\s\S]*?)<\/topic>/g;
  const map = [];
  let match;
  while ((match = regex.exec(myKnowledgeBase)) !== null) {
    map.push({ name: match[1], content: match[0] });
  }
  return map;
})();

// 2. دالة بحث بسيطة: تُعيد الـ topics التي يتقاطع اسمها أو محتواها مع كلمات السؤال
function retrieveRelevantTopics(query, topK = 3) {
  const words = query
    .replace(/[^\u0600-\u06FFa-zA-Z\s]/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 2);

  const scored = TOPICS.map(topic => {
    const haystack = (topic.name + ' ' + topic.content).toLowerCase();
    const score = words.reduce((acc, w) => {
      // وزن أعلى إذا الكلمة في اسم الـ topic
      const nameHit = topic.name.toLowerCase().includes(w) ? 3 : 0;
      const contentHit = haystack.includes(w) ? 1 : 0;
      return acc + nameHit + contentHit;
    }, 0);
    return { ...topic, score };
  });

  return scored
    .filter(t => t.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(t => t.content)
    .join('\n\n');
}

// ══════════════════════════════════════════════
//  Handler الرئيسي
// ══════════════════════════════════════════════
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

    // ── استخراج المعرفة ذات الصلة فقط ──
    const relevantKnowledge = retrieveRelevantTopics(message);
    
    // fallback: إذا لم يُطابق شيء، أعد رسالة واضحة بدل إرسال الكل
    const knowledgeBlock = relevantKnowledge.trim()
      ? relevantKnowledge
      : "لا توجد معلومات مباشرة متعلقة بهذا السؤال في قاعدة البيانات.";

    const safeHistory = (history || []).map(turn => ({
      role: turn.role === "assistant" ? "model" : turn.role,
      parts: (typeof turn.parts === "string") ? [{ text: turn.parts }] : turn.parts
    }));

    const systemInstruction = `You are the official Smart Assistant for the Agricultural Investment Promotion Agency (APIA) in Tunisia.

CRITICAL RULES:
1. LANGUAGE MATCH: Reply in the same language as the user query (Arabic or French or English). Never mix languages.
2. STRICT CONTEXT FOCUS: Answer ONLY using the knowledge provided below. If the answer is not in the knowledge, say so clearly.
3. CONCISE YET POWERFUL: Be highly direct, official, and professional.
4. MARKDOWN TABLES: Format numbers, percentages, and financial grants in clear Markdown tables.

RELEVANT KNOWLEDGE (retrieved for this query only):
<knowledge_base>
${knowledgeBlock}
</knowledge_base>`;

    const contents = [
      ...safeHistory,
      { role: "user", parts: [{ text: message }] }
    ];

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const response = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents,
        systemInstruction: { parts: [{ text: systemInstruction }] },
        generationConfig: { temperature: 0.0, topP: 0.95 }
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

    if (candidate?.content?.parts) {
      botReply = candidate.content.parts
        .filter(p => !p.thought && p.text)
        .map(p => p.text)
        .join("\n");
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
