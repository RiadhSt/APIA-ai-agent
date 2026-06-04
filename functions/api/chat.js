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
    const name = nameMatch ? nameMatch[1].trim() : "";

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
       ✅ Router باستخدام اسم الموضوع
    ====================================================== */
    const topicNames = topics.map(t => `- ${t.name}`).join("\n");

    const routerPrompt = `
You are a classification engine.

User Question:
"${message}"

Available Topics:
${topicNames}

Return ONLY the exact topic name from the list above.
If none match clearly, return: NONE
Do not explain anything.
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

    let selectedName =
      routerData?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    if (!selectedName || selectedName === "NONE") {
      return jsonResponse({
        reply: "هذه المعلومة غير متوفرة حالياً."
      });
    }

    // ✅ تنظيف الاسم من أي رموز أو تنصيص
    selectedName = selectedName.replace(/["']/g, "").trim();

    // ✅ مطابقة مرنة
    const selectedTopic = topics.find(t =>
      normalize(t.name) === normalize(selectedName) ||
      normalize(selectedName).includes(normalize(t.name)) ||
      normalize(t.name).includes(normalize(selectedName))
    );

    if (!selectedTopic) {
      return jsonResponse({
        reply: "هذه المعلومة غير متوفرة حالياً."
      });
    }

    /* =====================================================
       ✅ إرسال topic فقط للإجابة
    ====================================================== */
    const systemInstruction = `
You are the official APIA Assistant.

STRICT RULES:
1. Use ONLY the authorized content below.
2. Do not invent information.
3. Reply in same language as user.
4. Provide complete structured answer.
5. Use Markdown tables when relevant.

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

    if (
      answerData &&
      answerData.candidates &&
      answerData.candidates.length > 0 &&
      answerData.candidates[0].content &&
      answerData.candidates[0].content.parts
    ) {
      return jsonResponse({
        reply: answerData.candidates[0].content.parts
          .map(p => p.text)
          .join("\n")
      });
    }

    return jsonResponse({
      reply: "هذه المعلومة غير متوفرة حالياً."
    });

  } catch (error) {
    return jsonResponse({ error: error.message }, 500);
  }
}

/* ===========================================
   ✅ Normalize
=========================================== */
function normalize(text) {
  return (text || "")
    .toLowerCase()
    .replace(/[^\w\s\u0600-\u06FF]/g, "")
    .replace(/\bال/g, "")
    .replace(/ات\b/g, "")
    .replace(/ون\b/g, "")
    .replace(/ة\b/g, "")
    .trim();
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
