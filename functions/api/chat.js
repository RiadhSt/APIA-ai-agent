import { myKnowledgeBase } from './knowledge.js';

/* ===========================================
   ✅ استخراج Topics من النص
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
   ✅ Main Handler
=========================================== */
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
      return new Response(JSON.stringify({ error: "مفتاح GEMINI_API_KEY مفقود!" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const topics = parseTopics(myKnowledgeBase.knowledge);

    /* =====================================================
       ✅ المرحلة 1️⃣: Router خفيف (اختيار topic فقط)
    ====================================================== */
    const topicNames = topics.map(t => `- ${t.name}`).join("\n");

    const routerPrompt = `
You are a classification engine.

User Question:
"${message}"

Available Topics:
${topicNames}

Return ONLY the exact topic name from the list.
If none matches clearly, return: NONE
Do not explain.
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
      return new Response(JSON.stringify({
        reply: "هذه المعلومة غير متوفرة حالياً."
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    selectedName = selectedName.replace(/["']/g, "").trim();

    const selectedTopic = topics.find(t =>
      t.name === selectedName ||
      t.name.includes(selectedName) ||
      selectedName.includes(t.name)
    );

    if (!selectedTopic) {
      return new Response(JSON.stringify({
        reply: "هذه المعلومة غير متوفرة حالياً."
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    /* =====================================================
       ✅ المرحلة 2️⃣: إرسال Topic فقط (بدون كامل المعرفة)
    ====================================================== */
    const safeHistory = (history || []).map(turn => ({
      role: turn.role === "assistant" ? "model" : turn.role,
      parts: (typeof turn.parts === "string") ? [{ text: turn.parts }] : turn.parts
    }));

    const systemInstruction = `You are the official Smart Assistant for the Agricultural Investment Promotion Agency (APIA) in Tunisia.

CRITICAL RULES:
1. LANGUAGE MATCH: Reply in the same language as the user query.
2. STRICT CONTEXT FOCUS: Answer ONLY using the provided content.
3. Provide complete structured official answer.
4. Use Markdown tables for numbers and percentages.
5. Do NOT invent information.

AUTHORIZED KNOWLEDGE:
${selectedTopic.content}
`;

    const contents = [
      ...safeHistory,
      { role: "user", parts: [{ text: message }] }
    ];

    const answerResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents,
          systemInstruction: { parts: [{ text: systemInstruction }] },
          generationConfig: {
            temperature: 0.0,
            topP: 0.95,
            maxOutputTokens: 1200
          }
        })
      }
    );

    const answerData = await answerResponse.json();

    let botReply = "لم أتمكن من صياغة إجابة.";

    if (
      answerData &&
      answerData.candidates &&
      answerData.candidates.length > 0 &&
      answerData.candidates[0].content &&
      answerData.candidates[0].content.parts
    ) {
      botReply = answerData.candidates[0].content.parts
        .filter(part => part.text)
        .map(part => part.text)
        .join("\n");
    }

    return new Response(JSON.stringify({ reply: botReply }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
