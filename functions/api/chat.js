import { myKnowledgeBase } from './knowledge.js';

// ── تحليل الـ topics مرة واحدة عند التحميل ──
const TOPICS = (() => {
  const regex = /<topic\s+name="([^"]+)">([\s\S]*?)<\/topic>/g;
  const map = [];
  let match;
  while ((match = regex.exec(myKnowledgeBase)) !== null) {
    const name = match[1];
    const content = match[2];
    const headings = [];
    content.replace(/^#{1,3}\s+(.+)$/gm, (_, h) => headings.push(h.trim()));
    map.push({ name, content: match[0], headings });
  }
  return map;
})();

const STOP_WORDS = new Set([
  'في','من','إلى','على','هل','ما','هو','هي','عن','مع','أو','و','كيف',
  'الذي','التي','هذا','هذه','تلك','ذلك','كل','لا','نعم','أي','كم',
  'les','des','du','de','la','le','un','une','est','sont','pour','avec',
  'the','of','in','is','are','for','what','how','which','does','do'
]);

function extractKeywords(query) {
  return query
    .replace(/[?؟!،,\.]/g, ' ')
    .split(/\s+/)
    .map(w => w.trim().toLowerCase())
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

function retrieveRelevantTopics(query, topK = 3) {
  const normalizedQuery = normalizeArabic(query);
  const keywords = extractKeywords(normalizedQuery);

  if (keywords.length === 0) return '';

  const scored = TOPICS.map(topic => {
    const normalizedName = normalizeArabic(topic.name);
    const normalizedContent = normalizeArabic(topic.content);

    let score = 0;

    keywords.forEach(word => {
      if (normalizedName.includes(word)) score += 6;
      if (topic.headings.some(h => normalizeArabic(h).includes(word))) score += 4;
      if (normalizedContent.includes(word)) score += 2;
    });

    return { ...topic, score };
  });

  const selectedTopics = scored
    .filter(t => t.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  if (selectedTopics.length === 0) return '';

  const relevantSections = [];

  selectedTopics.forEach(topic => {
    const sections = topic.content.split(/\n## |\n# /);

    sections.forEach(section => {
      const normalizedSection = normalizeArabic(section);
      const matchCount = keywords.filter(k => normalizedSection.includes(k)).length;

      if (matchCount > 0) {
        relevantSections.push(section.trim());

        // ✅ توسعة ذكية: إذا القسم يحتوي "جرار"
        if (normalizedSection.includes("جرار")) {
          sections.forEach(s2 => {
            if (
              normalizeArabic(s2).includes("نسب") ||
              normalizeArabic(s2).includes("صنف") ||
              normalizeArabic(s2).includes("سقف")
            ) {
              relevantSections.push(s2.trim());
            }
          });
        }
      }
    });
  });

  // إزالة التكرار
  const unique = [...new Set(relevantSections)];

  return unique.join('\n\n').slice(0, 8000);
}

// ── تقليص الـ history ──
function trimHistory(history, maxTurns = 6) {
  if (!history || history.length <= maxTurns) return history || [];
  return history.slice(-maxTurns);
}

// ── Retry تلقائي ──
async function callGeminiWithRetry(url, body, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    if (response.ok) return response;

    const status = response.status;
    if ((status === 429 || status === 503) && attempt < maxRetries) {
      await new Promise(r => setTimeout(r, attempt * 1500));
      continue;
    }

    const data = await response.json().catch(() => ({}));
    const msg = status === 429 ? "الخدمة مشغولة، حاول بعد لحظة"
               : status === 401 ? "خطأ في مفتاح الـ API"
               : status === 503 ? "سيرفر Google غير متاح مؤقتاً"
               : data.error?.message || "خطأ غير متوقع";
    throw new Error(msg);
  }
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

    // ── RAG: knowledge ذات الصلة فقط ──
    const relevantKnowledge = retrieveRelevantTopics(message);
    const knowledgeBlock = relevantKnowledge.trim()
      ? relevantKnowledge
      : "لا توجد معلومات مباشرة متعلقة بهذا السؤال في قاعدة البيانات.";

    // ── History مُقلَّصة ──
    const safeHistory = trimHistory(history, 6).map(turn => ({
      role: turn.role === "assistant" ? "model" : turn.role,
      parts: (typeof turn.parts === "string") ? [{ text: turn.parts }] : turn.parts
    }));

    const systemInstruction = `You are the official Smart Assistant for the Agricultural Investment Promotion Agency (APIA) in Tunisia.

CRITICAL RULES:
1. LANGUAGE MATCH: Reply in the same language as the user query.
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

    let response;
    try {
      response = await callGeminiWithRetry(geminiUrl, {
        contents,
        systemInstruction: { parts: [{ text: systemInstruction }] },
        generationConfig: { temperature: 0.1, topP: 0.95 }
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 503,
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
