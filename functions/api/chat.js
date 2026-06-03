import { myKnowledgeBase } from "./knowledge.js";

/* ===========================================
   ✅ إعدادات
=========================================== */
const STOPWORDS = [
  "ما","هو","هي","في","من","على","الى","عن","هل",
  "the","is","are","what","how","de","la","le"
];

const MAX_SECTIONS = 2;

/* ===========================================
   ✅ استخراج Topics من النص الخام
=========================================== */
function parseTopicsFromKnowledge(rawKnowledge) {
  const topics = [];
  const topicRegex = /<topic([\s\S]*?)>([\s\S]*?)<\/topic>/g;

  let match;

  while ((match = topicRegex.exec(rawKnowledge)) !== null) {
    const attributes = match[1];
    const content = match[2];

    const nameMatch = attributes.match(/name="([^"]+)"/);
    const keywordsMatch = attributes.match(/keywords="([^"]+)"/);

    const name = nameMatch ? nameMatch[1] : "";
    const keywords = keywordsMatch
      ? keywordsMatch[1].split(",").map(k => k.trim())
      : [];

    topics.push({
      name,
      keywords,
      content
    });
  }

  return topics;
}

/* ===========================================
   ✅ نقطة الدخول
=========================================== */
export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const { message } = await request.json();
    const apiKey = env.GEMINI_API_KEY;

    if (!apiKey) {
      return jsonResponse({ error: "GEMINI_API_KEY غير موجود" }, 500);
    }

    const tokens = tokenize(message);

    /* ✅ استخراج topics من النص */
    const topics = parseTopicsFromKnowledge(myKnowledgeBase.knowledge);

    /* =====================================
       ✅ اختيار أفضل topic
    ===================================== */
    let bestScore = 0;
    let bestTopic = null;

    for (const topic of topics) {
      let score = 0;

      // ✅ مطابقة الاسم
      score += scoreTokens(tokens, tokenize(topic.name)) * 3;

      // ✅ مطابقة keywords
      score += scoreTokens(tokens, topic.keywords.map(k => normalize(k)));

      // ✅ مطابقة المحتوى
      score += scoreTokens(tokens, tokenize(topic.content));

      if (score > bestScore) {
        bestScore = score;
        bestTopic = topic;
      }
    }

    if (!bestTopic) {
      return jsonResponse({
        reply: "هذه المعلومة غير متوفرة حالياً."
      });
    }

    /* =====================================
       ✅ إرسال topic المختار فقط
    ===================================== */
    const systemInstruction = `
You are the official APIA assistant.

STRICT RULES:
1. Use ONLY the authorized content below.
2. If answer not found → reply: "المعلومة غير متوفرة".
3. Do not invent information.
4. Reply in same language as user.

AUTHORIZED CONTENT:
${bestTopic.content}
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
   ✅ أدوات معالجة النص
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

function scoreTokens(queryTokens, targetTokens) {
  let score = 0;

  for (const token of queryTokens) {
    if (targetTokens.includes(token)) {
      score++;
    }
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
