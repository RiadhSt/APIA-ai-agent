import { myKnowledgeBase } from "./knowledge.js";

/* ===========================================
   ✅ إعدادات
=========================================== */
const STOPWORDS = [
  "ما","هو","هي","في","من","على","الى","عن","هل",
  "the","is","are","what","how","de","la","le"
];

const FAST_MATCH_THRESHOLD = 6;

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
      return jsonResponse({ error: "API Key missing" }, 500);
    }

    const topics = parseTopics(myKnowledgeBase.knowledge);

    const queryTokens = tokenize(message);

    /* =====================================================
       ✅ المرحلة 1️⃣: JS Fast Retrieval
    ====================================================== */
    let bestTopic = null;
    let bestScore = 0;

    for (const topic of topics) {
      let score = 0;

      score += scoreOverlap(queryTokens, tokenize(topic.name)) * 4;
      score += scoreOverlap(queryTokens, tokenize(topic.content));

      if (score > bestScore) {
        bestScore = score;
        bestTopic = topic;
      }
    }

    /* =====================================================
       ✅ إذا الثقة عالية → لا نحتاج Router
    ====================================================== */
    if (bestTopic && bestScore >= FAST_MATCH_THRESHOLD) {
      return await generateAnswer(bestTopic.content, message, apiKey);
    }

    /* =====================================================
       ✅ المرحلة 2️⃣: Gemini Router (عند الحاجة فقط)
    ====================================================== */
    const topicNames = topics.map(t => t.name).join("\n");

    const routerPrompt = `
You are a classification engine.

User Question:
"${message}"

Available Topics:
${topicNames}

Return ONLY the exact topic name.
If none matches → return NONE.
`;

    const routerResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: routerPrompt }] }],
          generationConfig: {
            temperature: 0.0,
            maxOutputTokens: 50
          }
        })
      }
    );

    const routerData = await routerResponse.json();

    const selectedTopicName =
      routerData?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    if (!selectedTopicName || selectedTopicName === "NONE") {
      return jsonResponse({
        reply: "هذه المعلومة غير متوفرة حالياً."
      });
    }

    const selectedTopic = topics.find(
      t => t.name === selectedTopicName
    );

    if (!selectedTopic) {
      return jsonResponse({
        reply: "هذه المعلومة غير متوفرة حالياً."
      });
    }

    /* =====================================================
       ✅ المرحلة 3️⃣: الإجابة النهائية
    ====================================================== */
    return await generateAnswer(selectedTopic.content, message, apiKey);

  } catch (error) {
    return jsonResponse({ error: error.message }, 500);
  }
}

/* ===========================================
   ✅ توليد الإجابة
=========================================== */
async function generateAnswer(content, message, apiKey) {
  const systemInstruction = `
You are the official APIA Assistant.

STRICT RULES:
1. Use ONLY the authorized content below.
2. Do not invent information.
3. Reply in same language as user.
4. Provide complete structured answer.
5. Use Markdown tables where relevant.

AUTHORIZED CONTENT:
${content}
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
          maxOutputTokens: 1200
        }
      })
    }
  );

  const data = await response.json();

  const reply =
    data?.candidates?.[0]?.content?.parts
      ?.map(p => p.text)
      ?.join("\n") || "لم أتمكن من صياغة إجابة.";

  return jsonResponse({ reply });
}

/* ===========================================
   ✅ أدوات
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
    if (targetTokens.includes(token)) score++;
  }
  return score;
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
