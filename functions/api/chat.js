import { myKnowledgeBase } from './knowledge.js';

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
      return jsonResponse({ error: "GEMINI_API_KEY غير موجود" }, 500);
    }

    const userMessage = message.trim().toLowerCase();

    // ======================================================
    // ✅ 1️⃣ البحث في FAQ أولاً (بدون Gemini)
    // ======================================================

    const faqMatch = searchFAQ(userMessage);

    if (faqMatch) {
      return jsonResponse({ reply: faqMatch });
    }

    // ======================================================
    // ✅ 2️⃣ البحث عن topic مناسب
    // ======================================================

    const matchedTopic = findBestTopic(userMessage);

    if (!matchedTopic) {
      return jsonResponse({
        reply: "هذه المعلومة غير متوفرة حالياً، يُرجى التواصل مع خبرائنا."
      });
    }

    // ======================================================
    // ✅ 3️⃣ إرسال الـ topic المختار فقط إلى Gemini
    // ======================================================

    const safeHistory = (history || []).slice(-6).map(turn => ({
      role: turn.role === "assistant" ? "model" : "user",
      parts: [{ text: turn.parts }]
    }));

    const systemInstruction = `
You are the official Smart Assistant for APIA (Agricultural Investment Promotion Agency).

STRICT RULES:
1. Answer ONLY using the provided topic content.
2. Do NOT invent information.
3. Reply in the same language as the user.
4. Use Markdown tables for percentages and numbers.
5. Be precise and official.

AUTHORIZED TOPIC:
${matchedTopic.content}
`;

    const contents = [
      ...safeHistory,
      { role: "user", parts: [{ text: message }] }
    ];

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const response = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents,
        systemInstruction: { parts: [{ text: systemInstruction }] },
        generationConfig: {
          temperature: 0.0,
          topP: 0.9,
          maxOutputTokens: 1500
        }
      })
    });

    const data = await response.json();

    const botReply =
      data.candidates?.[0]?.content?.parts
        ?.filter(p => p.text)
        ?.map(p => p.text)
        ?.join("\n") || "لم أتمكن من صياغة إجابة.";

    return jsonResponse({ reply: botReply });

  } catch (error) {
    return jsonResponse({ error: error.message }, 500);
  }
}

// ======================================================
// ✅ البحث في FAQ
// ======================================================

function searchFAQ(userMessage) {
  for (const item of myKnowledgeBase.faq) {
    const score = calculateMatchScore(userMessage, item.keywords);
    if (score >= 2) { // شرط تطابق
      return item.answer;
    }
  }
  return null;
}

// ======================================================
// ✅ اختيار أفضل Topic
// ======================================================

function findBestTopic(userMessage) {
  let bestMatch = null;
  let highestScore = 0;

  for (const topic of myKnowledgeBase.topics) {
    const score = calculateMatchScore(userMessage, topic.keywords);

    if (score > highestScore) {
      highestScore = score;
      bestMatch = topic;
    }
  }

  return highestScore > 0 ? bestMatch : null;
}

// ======================================================
// ✅ حساب عدد الكلمات المتطابقة
// ======================================================

function calculateMatchScore(text, keywords) {
  let score = 0;

  for (const word of keywords) {
    if (text.includes(word.toLowerCase())) {
      score++;
    }
  }

  return score;
}

// ======================================================
// ✅ دالة الرد الموحد
// ======================================================

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "application/json"
    }
  });
}
