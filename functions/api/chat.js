import { myKnowledgeBase } from './knowledge.js';

// ══════════════════════════════════════════════
//  تحليل الـ topics مرة واحدة عند التحميل
// ══════════════════════════════════════════════
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

// ══════════════════════════════════════════════
//  Stop words عربية + فرنسية + إنجليزية
// ══════════════════════════════════════════════
const STOP_WORDS = new Set([
  'في','من','إلى','على','هل','ما','هو','هي','عن','مع','أو','و','كيف',
  'الذي','التي','هذا','هذه','تلك','ذلك','كل','لا','نعم','أي','كم',
  'les','des','du','de','la','le','un','une','est','sont','pour','avec',
  'the','of','in','is','are','for','what','how','which','does','do'
]);

// ══════════════════════════════════════════════
//  استخراج الكلمات المفيدة من السؤال
// ══════════════════════════════════════════════
function extractKeywords(query) {
  return query
    .replace(/[?؟!،,\.]/g, ' ')
    .split(/\s+/)
    .map(w => w.trim().toLowerCase())
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

// ══════════════════════════════════════════════
//  RAG — استخراج الـ topics ذات الصلة فقط
// ══════════════════════════════════════════════
function retrieveRelevantTopics(query, topK = 3) {
  const keywords = extractKeywords(query);
  if (keywords.length === 0) return '';

  const scored = TOPICS.map(topic => {
    let score = 0;
    keywords.forEach(word => {
      if (topic.name.toLowerCase().includes(word))                    score += 5;
      if (topic.headings.some(h => h.toLowerCase().includes(word)))   score += 3;
      if (topic.content.toLowerCase().includes(word))                 score += 1;
    });
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
//  تقليص الـ history — آخر N رسائل فقط
// ══════════════════════════════════════════════
function trimHistory(history, maxTurns = 6) {
  if (!history || history.length <= maxTurns) return history || [];
  return history.slice(-maxTurns);
}

// ══════════════════════════════════════════════
//  Retry تلقائي عند خطأ مؤقت من Google
// ══════════════════════════════════════════════
async function callGeminiWithRetry(url, body, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    if (response.ok) return response;

    const status = response.status;

    // خطأ مؤقت — أعد المحاولة بعد انتظار متصاعد
    if ((status === 429 || status === 503) && attempt < maxRetries) {
      await new Promise(r => setTimeout(r, attempt * 1500)); // 1.5s ثم 3s
      continue;
    }

    // خطأ دائم — رسالة واضحة
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

  // معالجة OPTIONS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
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

    // ── حماية Backend: حد أقصى 5 أسئلة للمحادثة الواحدة ──
    const questionCount = (history || [])
      .filter(t => t.role === "user").length;

    if (questionCount >= 5) {
      return new Response(JSON.stringify({
        error: "limit_reached",
        reply: "⚠️ لقد وصلت إلى الحد الأقصى لهذه المحادثة (5 أسئلة). يرجى بدء محادثة جديدة."
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // ── RAG: استخراج المعرفة ذات الصلة فقط ──
    const relevantKnowledge = retrieveRelevantTopics(message);
    const knowledgeBlock = relevantKnowledge.trim()
      ? relevantKnowledge
      : "لا توجد معلومات مباشرة متعلقة بهذا السؤال في قاعدة البيانات.";

    // ── History مُقلَّصة: آخر 6 رسائل فقط ──
    const safeHistory = trimHistory(history, 6).map(turn => ({
      role: turn.role === "assistant" ? "model" : turn.role,
      parts: (typeof turn.parts === "string") ? [{ text: turn.parts }] : turn.parts
    }));

    // ── System Instruction ──
    const systemInstruction = `You are the official Smart Assistant for the Agricultural Investment Promotion Agency (APIA) in Tunisia.

CRITICAL RULES:
1. LANGUAGE: If the user writes in Arabic reply in Arabic. If the user writes in French reply in French. If the user writes in English reply in French. Never mix languages.
2. STRICT CONTEXT FOCUS: Answer ONLY using the knowledge provided below. If the answer is not in the knowledge, say clearly in the user's language that you don't have this information.
3. CONCISE YET POWERFUL: Be highly direct, official, and professional. No filler or introductory prose.
4. MARKDOWN TABLES: Format numbers, percentages, and financial data exclusively in clear Markdown tables.

RELEVANT KNOWLEDGE (retrieved for this query only):
<knowledge_base>
${knowledgeBlock}
</knowledge_base>`;

    const contents = [
      ...safeHistory,
      { role: "user", parts: [{ text: message }] }
    ];

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    // ── استدعاء Gemini مع Retry ──
    let response;
    try {
      response = await callGeminiWithRetry(geminiUrl, {
        contents,
        systemInstruction: { parts: [{ text: systemInstruction }] },
        generationConfig: {
          temperature: 0.0,
          topP: 0.95
        }
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
