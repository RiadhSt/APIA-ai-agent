import { myKnowledgeBase } from './knowledge.js';

const STOPWORDS = [
  "ما", "هو", "هي", "في", "من", "على", "الى", "عن", "هل",
  "the", "is", "are", "what", "how", "de", "la", "le"
];

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const { message, history } = await request.json();
    const apiKey = env.GEMINI_API_KEY;

    if (!apiKey) {
      return jsonResponse({ error: "API Key missing" }, 500);
    }

    const cleanMessage = normalize(message);

    // =====================================================
    // ✅ 1️⃣ FAQ Search (Weighted Matching)
    // =====================================================

    const faqResult = searchFAQAdvanced(cleanMessage);

    if (faqResult) {
      return jsonResponse({ reply: faqResult });
    }

    // =====================================================
    // ✅ 2️⃣ Topic Selection (Best Match)
    // =====================================================

    const topic = findBestTopicAdvanced(cleanMessage);

    if (!topic) {
      return jsonResponse({
        reply: "هذه المعلومة غير متوفرة حالياً."
      });
    }

    // =====================================================
    // ✅ 3️⃣ Section Selection (Precise Context Extraction)
    // =====================================================

    const bestSections = selectRelevantSections(topic, cleanMessage);

    if (!bestSections.length) {
      return jsonResponse({
        reply: "لم يتم العثور على معلومات دقيقة حول هذا السؤال."
      });
    }

    // =====================================================
    // ✅ 4️⃣ Call Gemini With Minimal Context
    // =====================================================

    const systemInstruction = `
You are the official APIA Assistant.

STRICT RULES:
1. Use ONLY the provided authorized content.
2. If the answer is not present → say it is unavailable.
3. Reply in same language as user.
4. Use Markdown tables for numbers and percentages.
5. Be precise and official.

AUTHORIZED CONTENT:
${bestSections.join("\n\n")}
`;

    const contents = [
      ...(history || []).slice(-4).map(turn => ({
        role: turn.role === "assistant" ? "model" : "user",
        parts: [{ text: turn.parts }]
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
      data.candidates?.[0]?.content?.parts
        ?.filter(p => p.text)
        ?.map(p => p.text)
        ?.join("\n") || "لم أتمكن من صياغة إجابة.";

    return jsonResponse({ reply });

  } catch (error) {
    return jsonResponse({ error: error.message }, 500);
  }
}

// =====================================================
// 🔎 FAQ Advanced Search
// =====================================================

function searchFAQAdvanced(message) {
  let bestScore = 0;
  let bestAnswer = null;

  for (const item of myKnowledgeBase.faq) {
    const score = calculateScore(message, item.keywords);
    if (score > bestScore) {
      bestScore = score;
      bestAnswer = item.answer;
    }
  }

  return bestScore >= 2 ? bestAnswer : null;
}

// =====================================================
// 🔎 Topic Advanced Search
// =====================================================

function findBestTopicAdvanced(message) {
  let bestScore = 0;
  let bestTopic = null;

  for (const topic of myKnowledgeBase.topics) {
    const score = calculateScore(message, topic.keywords);
    if (score > bestScore) {
      bestScore = score;
      bestTopic = topic;
    }
  }

  return bestScore >= 1 ? bestTopic : null;
}

// =====================================================
// 🔎 Select Relevant Sections
// =====================================================

function selectRelevantSections(topic, message) {
  const sections = topic.sections || [];
  const ranked = [];

  for (const section of sections) {
    const score = calculateScore(message, extractKeywords(section.content));
    if (score > 0) {
      ranked.push({ score, content: section.content });
    }
  }

  ranked.sort((a, b) => b.score - a.score);

  return ranked.slice(0, 2).map(r => r.content);
}

// =====================================================
// 🧠 Smart Scoring
// =====================================================

function calculateScore(text, keywords) {
  let score = 0;

  for (const word of keywords) {
    if (text.includes(word.toLowerCase())) {
      score += 2;
    }
  }

  return score;
}

// =====================================================
// 🧠 Extract Keywords From Section
// =====================================================

function extractKeywords(text) {
  return text
    .split(/\W+/)
    .filter(w => w.length > 4 && !STOPWORDS.includes(w.toLowerCase()));
}

// =====================================================
// 🔧 Normalize Text
// =====================================================

function normalize(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s\u0600-\u06FF]/g, "");
}

// =====================================================
// ✅ JSON Response
// =====================================================

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "application/json"
    }
  });
}
