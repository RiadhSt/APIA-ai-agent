import { myKnowledgeBase } from "./knowledge.js";

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

    /* =====================================================
       ✅ المرحلة 1️⃣: Router Call (اختيار topic بالذكاء)
    ====================================================== */
    const topicNames = topics.map(t => t.name).join("\n");

    const routerPrompt = `
You are a classification engine.

User Question:
"${message}"

Available Topics:
${topicNames}

Instructions:
- Return ONLY the exact topic name that best matches the question.
- If none matches clearly, return: NONE
- Do not explain.
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
       ✅ المرحلة 2️⃣: إرسال محتوى topic فقط
    ====================================================== */
    const systemInstruction = `
You are the official APIA Assistant.

STRICT RULES:
1. Use ONLY the content provided below.
2. Do not invent information.
3. Reply in the same language as the user.
4. Provide complete structured answer.
5. Use Markdown tables where relevant.

AUTHORIZED CONTENT:
${selectedTopic.content}
`;

    const answerResponse = await fetch(
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

    const answerData = await answerResponse.json();

    const reply =
      answerData?.candidates?.[0]?.content?.parts
        ?.map(p => p.text)
        ?.join("\n") || "لم أتمكن من صياغة إجابة.";

    return jsonResponse({ reply });

  } catch (error) {
    return jsonResponse({ error: error.message }, 500);
  }
}

/* ===========================================
   ✅ Helper
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
