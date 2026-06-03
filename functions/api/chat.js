import { myKnowledgeBase } from "./knowledge.js";

/* ================================
   ✅ كلمات توقف بسيطة
================================ */
const STOPWORDS = [
  "ما","هو","هي","في","من","على","الى","عن","هل",
  "the","is","are","what","how","de","la","le"
];

/* ================================
   ✅ نقطة الدخول الرئيسية
================================ */
export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const { message, history } = await request.json();
    const apiKey = env.GEMINI_API_KEY;

    if (!apiKey) {
      return jsonResponse({ error: "GEMINI_API_KEY غير موجود" }, 500);
    }

    const cleanMessage = normalize(message);

    /* =====================================
       ✅ 1️⃣ البحث في FAQ أولاً
    ===================================== */
    const faqAnswer = searchFAQ(cleanMessage);

    if (faqAnswer) {
      return jsonResponse({ reply: faqAnswer });
    }

    /* =====================================
       ✅ 2️⃣ اختيار أفضل Topic
    ===================================== */
    const topic = findBestTopic(cleanMessage);

    if (!topic) {
      return jsonResponse({
        reply: "هذه المعلومة غير متوفرة حالياً."
      });
    }

    /* =====================================
       ✅ 3️⃣ اختيار أفضل Sections فقط
    ===================================== */
    const sections = selectRelevantSections(topic, cleanMessage);

    if (!sections.length) {
      return jsonResponse({
        reply: "لم يتم العثور على معلومات دقيقة حول هذا السؤال."
      });
    }

    /* =====================================
       ✅ 4️⃣ استدعاء Gemini بسياق محدود
    ===================================== */
    const systemInstruction = `
You are the official Smart Assistant for APIA.

STRICT RULES:
1. Use ONLY the authorized content below.
2. If answer not found in content, say it is unavailable.
3. Reply in same language as the user.
4. Use Markdown tables for numbers and percentages.
5. Be direct and professional.

AUTHORIZED CONTENT:
${sections.join("\n\n")}
`;

    const contents = [
      ...(Array.isArray(history) ? history.slice(-4) : []).map(turn => ({
        role: turn.role === "assistant" ? "model" : "user",
        parts: [{ text: typeof turn.parts === "string" ? turn.parts : "" }]
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
            topP: 0.9,
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

/* =====================================
   ✅ FAQ Search
===================================== */
function searchFAQ(message) {
  const faqList = Array.isArray(myKnowledgeBase?.faq)
    ? myKnowledgeBase.faq
    : [];

  let bestScore = 0;
  let bestAnswer = null;

  for (const item of faqList) {
    const score = calculateScore(message, item?.keywords || []);

    if (score > bestScore) {
      bestScore = score;
      bestAnswer = item?.answer || null;
    }
  }

  return bestScore >= 2 ? bestAnswer : null;
}

/* =====================================
   ✅ Topic Selection
===================================== */
function findBestTopic(message) {
  const topics = Array.isArray(myKnowledgeBase?.topics)
    ? myKnowledgeBase.topics
    : [];

  let bestScore = 0;
  let bestTopic = null;

  for (const topic of topics) {
    const score = calculateScore(message, topic?.keywords || []);

    if (score > bestScore) {
      bestScore = score;
      bestTopic = topic;
    }
  }

  return bestScore >= 1 ? bestTopic : null;
}

/* =====================================
   ✅ Section Extraction
===================================== */
function selectRelevantSections(topic, message) {
  const sections = Array.isArray(topic?.sections)
    ? topic.sections
    : [];

  const ranked = [];

  for (const section of sections) {
    const keywords = extractKeywords(section?.content || "");
    const score = calculateScore(message, keywords);

    if (score > 0) {
      ranked.push({
        score,
        content: section.content
      });
    }
  }

  ranked.sort((a, b) => b.score - a.score);

  return ranked.slice(0, 2).map(r => r.content);
}

/* =====================================
   ✅ Smart Scoring (Safe)
===================================== */
function calculateScore(text, keywords) {
  if (!Array.isArray(keywords)) return 0;

  let score = 0;

  for (const word of keywords) {
    if (typeof word === "string" && text.includes(word.toLowerCase())) {
      score += 2;
    }
  }

  return score;
}

/* =====================================
   ✅ Extract Keywords from Content
===================================== */
function extractKeywords(text) {
  return text
    .split(/\W+/)
    .filter(
      w =>
        w.length > 4 &&
        !STOPWORDS.includes(w.toLowerCase())
    );
}

/* =====================================
   ✅ Normalize Text
===================================== */
function normalize(text) {
  return (text || "")
    .toLowerCase()
    .replace(/[^\w\s\u0600-\u06FF]/g, "");
}

/* =====================================
   ✅ JSON Response Helper
===================================== */
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "application/json"
    }
  });
}
