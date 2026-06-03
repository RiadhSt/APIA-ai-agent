import { myKnowledgeBase } from "./knowledge.js";

/* ===========================================
   ✅ إعدادات
=========================================== */
const STOPWORDS = [
  "ما","هو","هي","في","من","على","الى","عن","هل",
  "the","is","are","what","how","de","la","le"
];

const FAQ_THRESHOLD = 2;
const TOPIC_THRESHOLD = 1;
const MAX_SECTIONS = 2;

/* ===========================================
   ✅ Parser FAQ
=========================================== */
function parseFAQ(rawFAQ) {
  const items = [];
  const regex = /<qa>([\s\S]*?)<\/qa>/g;

  let match;
  while ((match = regex.exec(rawFAQ)) !== null) {
    const block = match[1];
    const q = block.match(/<q>([\s\S]*?)<\/q>/);
    const a = block.match(/<a>([\s\S]*?)<\/a>/);

    if (q && a) {
      items.push({
        question: q[1].trim(),
        answer: a[1].trim()
      });
    }
  }

  return items;
}

/* ===========================================
   ✅ Parser Topics
=========================================== */
function parseTopics(rawKnowledge) {
  const topics = [];
  const regex = /<topic([\s\S]*?)>([\s\S]*?)<\/topic>/g;

  let match;
  while ((match = regex.exec(rawKnowledge)) !== null) {
    const attributes = match[1];
    const content = match[2];

    const nameMatch = attributes.match(/name="([^"]+)"/);
    const name = nameMatch ? nameMatch[1] : "";

    topics.push({
      name,
      content
    });
  }

  return topics;
}

/* ===========================================
   ✅ Entry Point
=========================================== */
export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const { message } = await request.json();
    const apiKey = env.GEMINI_API_KEY;

    if (!apiKey) {
      return jsonResponse({ error: "GEMINI_API_KEY missing" }, 500);
    }

    const queryTokens = tokenize(message);

    const faqItems = parseFAQ(myKnowledgeBase.faq);
    const topics = parseTopics(myKnowledgeBase.knowledge);

    /* ===============================
       ✅ 1️⃣ FAQ Ranking
    ================================ */
    let bestFAQ = null;
    let bestFAQScore = 0;

    for (const item of faqItems) {
      const score = scoreOverlap(queryTokens, tokenize(item.question));
      if (score > bestFAQScore) {
        bestFAQScore = score;
        bestFAQ = item;
      }
    }

    if (bestFAQScore >= FAQ_THRESHOLD) {
      return jsonResponse({ reply: bestFAQ.answer });
    }

    /* ===============================
       ✅ 2️⃣ Topic Ranking
    ================================ */
    let bestTopic = null;
    let bestTopicScore = 0;

    for (const topic of topics) {
      let score = 0;

      // تطابق الاسم
      score += scoreOverlap(queryTokens, tokenize(topic.name)) * 3;

      // تطابق المحتوى
      score += scoreOverlap(queryTokens, tokenize(topic.content));

      if (score > bestTopicScore) {
        bestTopicScore = score;
        bestTopic = topic;
      }
    }

    if (!bestTopic || bestTopicScore < TOPIC_THRESHOLD) {
      return jsonResponse({
        reply: "هذه المعلومة غير متوفرة حالياً."
      });
    }

    /* ===============================
       ✅ 3️⃣ Section-Level Ranking
    ================================ */
    const sections = splitSections(bestTopic.content);

    const rankedSections = sections
      .map(section => ({
        score: scoreOverlap(queryTokens, tokenize(section)),
        content: section
      }))
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_SECTIONS)
      .map(s => s.content);

    const authorizedContent =
      rankedSections.length > 0
        ? rankedSections.join("\n\n")
        : bestTopic.content.slice(0, 2000);

    /* ===============================
       ✅ 4️⃣ Gemini Strict Call
    ================================ */
    const systemInstruction = `
You are the official APIA Assistant.

STRICT RULES:
1. Use ONLY the authorized content below.
2. If answer not found → reply: "المعلومة غير متوفرة".
3. Do not invent information.
4. Reply in same language as user.
5. Use Markdown tables for numbers and percentages.

AUTHORIZED CONTENT:
${authorizedContent}
`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: message }] }],
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
   ✅ Utilities
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

function tokenize(text) {
  return normalize(text)
    .split(/\s+/)
    .filter(word =>
      word.length > 2 &&
      !STOPWORDS.includes(word)
    );
}

function scoreOverlap(queryTokens, targetTokens) {
  let score = 0;

  for (const token of queryTokens) {
    if (targetTokens.includes(token)) {
      score++;
    }
  }

  return score;
}

function splitSections(content) {
  return content.split(/\n## |\n# /).filter(Boolean);
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "application/json"
    }
  });
}
