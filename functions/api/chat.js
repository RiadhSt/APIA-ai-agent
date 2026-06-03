import { myKnowledgeBase } from "./knowledge.js";

/* ===========================================
   ✅ إعدادات النظام
=========================================== */
const STOPWORDS = [
  "ما","هو","هي","في","من","على","الى","عن","هل",
  "the","is","are","what","how","de","la","le"
];

const MAX_SECTIONS = 2;
const FAQ_THRESHOLD = 3;
const TOPIC_THRESHOLD = 1;

/* ===========================================
   ✅ نقطة الدخول الرئيسية
=========================================== */
export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const { message, history } = await request.json();
    const apiKey = env.GEMINI_API_KEY;

    if (!apiKey) {
      return jsonResponse({ error: "GEMINI_API_KEY غير موجود" }, 500);
    }

    const normalized = normalize(message);
    const tokens = tokenize(normalized);

    /* ===============================
       1️⃣ البحث في FAQ أولاً
    ================================ */
    const faqAnswer = retrieveFAQ(tokens);

    if (faqAnswer) {
      return jsonResponse({ reply: faqAnswer });
    }

    /* ===============================
       2️⃣ اختيار أفضل Topic
    ================================ */
    const bestTopic = retrieveBestTopic(tokens);

    if (!bestTopic) {
      return jsonResponse({
        reply: "هذه المعلومة غير متوفرة حالياً."
      });
    }

    /* ===============================
       3️⃣ اختيار أفضل Sections
    ================================ */
    const bestSections = retrieveBestSections(bestTopic, tokens);

    if (!bestSections.length) {
      return jsonResponse({
        reply: "هذه المعلومة غير متوفرة حالياً."
      });
    }

    /* ===============================
       4️⃣ استدعاء Gemini بسياق محدود
    ================================ */
    const systemInstruction = `
You are the official APIA Smart Assistant.

STRICT RULES:
1. Use ONLY the authorized content below.
2. If answer not found → reply: "المعلومة غير متوفرة".
3. Do NOT invent information.
4. Reply in same language as user.
5. Use Markdown tables for numbers and percentages.
6. Be concise and official.

AUTHORIZED CONTENT:
${bestSections.join("\n\n")}
`;

    const contents = [
      ...(Array.isArray(history) ? history.slice(-4) : []).map(turn => ({
        role: turn.role === "assistant" ? "model" : "user",
        parts: [{ text: safeText(turn.parts) }]
      })),
      { role: "user", parts: [{ text: message }] }
    ];

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents,
          systemInstruction: { parts: [{ text: systemInstruction }] },
          generationConfig: {
            temperature: 0.0,
            topP: 0.85,
            maxOutputTokens: 1200
          }
        })
      }
    );

    const data = await response.json();

    const reply =
      data?.candidates?.[0]?.content?.parts
        ?.filter(p => p.text)
        ?.map(p => p.text)
        ?.join("\n") || "لم أتمكن من صياغة إجابة.";

    return jsonResponse({ reply });

  } catch (error) {
    return jsonResponse({ error: error.message }, 500);
  }
}

/* ===========================================
   ✅ FAQ Retrieval
=========================================== */
function retrieveFAQ(tokens) {
  const faqList = Array.isArray(myKnowledgeBase?.faq)
    ? myKnowledgeBase.faq
    : [];

  let bestScore = 0;
  let bestAnswer = null;

  for (const item of faqList) {
    const score = scoreKeywords(tokens, item?.keywords || []);
    if (score > bestScore) {
      bestScore = score;
      bestAnswer = item?.answer || null;
    }
  }

  return bestScore >= FAQ_THRESHOLD ? bestAnswer : null;
}

/* ===========================================
   ✅ Topic Retrieval
=========================================== */
function retrieveBestTopic(tokens) {
  const topics = Array.isArray(myKnowledgeBase?.topics)
    ? myKnowledgeBase.topics
    : [];

  let bestScore = 0;
  let bestTopic = null;

  for (const topic of topics) {
    const score = scoreKeywords(tokens, topic?.keywords || []);
    if (score > bestScore) {
      bestScore = score;
      bestTopic = topic;
    }
  }

  return bestScore >= TOPIC_THRESHOLD ? bestTopic : null;
}

/* ===========================================
   ✅ Section Retrieval
=========================================== */
function retrieveBestSections(topic, tokens) {
  const sections = Array.isArray(topic?.sections)
    ? topic.sections
    : [];

  const ranked = [];

  for (const section of sections) {
    const sectionTokens = tokenize(section?.content || "");
    const score = scoreTokens(tokens, sectionTokens);

    if (score > 0) {
      ranked.push({
        score,
        content: section.content
      });
    }
  }

  ranked.sort((a, b) => b.score - a.score);

  return ranked.slice(0, MAX_SECTIONS).map(r => r.content);
}

/* ===========================================
   ✅ Advanced Arabic Normalization
=========================================== */
function normalize(text) {
  return (text || "")
    .toLowerCase()
    .replace(/[^\w\s\u0600-\u06FF]/g, "")
    .replace(/\bال/g, "")
    .replace(/ات\b/g, "")
    .replace(/ون\b/g, "")
    .replace(/ة\b/g, "");
}

/* ===========================================
   ✅ Tokenizer
=========================================== */
function tokenize(text) {
  return normalize(text)
    .split(/\s+/)
    .filter(word =>
      word.length > 2 &&
      !STOPWORDS.includes(word)
    );
}

/* ===========================================
   ✅ Fuzzy Match
=========================================== */
function fuzzyMatch(word, list) {
  return list.some(item =>
    item.includes(word) || word.includes(item)
  );
}

/* ===========================================
   ✅ Keyword Scoring
=========================================== */
function scoreKeywords(tokens, keywords) {
  if (!Array.isArray(keywords)) return 0;

  const normalizedKeywords = keywords.map(k => normalize(k));
  let score = 0;

  for (const token of tokens) {
    if (fuzzyMatch(token, normalizedKeywords)) {
      score += 3;
    }
  }

  return score;
}

/* ===========================================
   ✅ Section Token Scoring
=========================================== */
function scoreTokens(queryTokens, sectionTokens) {
  let score = 0;

  for (const token of queryTokens) {
    if (fuzzyMatch(token, sectionTokens)) {
      score++;
    }
  }

  return score;
}

/* ===========================================
   ✅ Safe Text
=========================================== */
function safeText(text) {
  return typeof text === "string" ? text : "";
}

/* ===========================================
   ✅ JSON Response
=========================================== */
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "application/json"
    }
  });
}
