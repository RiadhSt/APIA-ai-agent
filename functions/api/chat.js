import { myKnowledgeBase } from './knowledge.js';

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const MAX_HISTORY_TURNS = 3;
const MAX_QUESTIONS_PER_SESSION = 5;
const MAX_OUTPUT_TOKENS = 2000;
const TIMEOUT_MS = 28000;

const GEMINI_URL = (apiKey) =>
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

const SYSTEM_INSTRUCTION_TEXT = `You are the official Smart Assistant for the Agricultural Investment Promotion Agency (APIA) in Tunisia.

CRITICAL RULES:
1. LANGUAGE MATCH: Reply in the same language as the user query.
2. STRICT CONTEXT FOCUS: Answer ONLY using the provided knowledge below.
3. Provide complete structured answer.
4. MARKDOWN TABLES: Format ALL numbers, percentages, and financial grants exclusively in clear Markdown tables. Do not write numbers in raw text.
5. When using Markdown tables, always complete the full table including all rows.
6. Do NOT invent information.

<knowledge_base>
${myKnowledgeBase}
</knowledge_base>`.trim();

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const corsWithJson = { ...CORS_HEADERS, "Content-Type": "application/json" };
    const body = await request.json().catch(() => null);

    if (!body) {
      return new Response(JSON.stringify({ error: "Body JSON غير صالح" }), {
        status: 400,
        headers: corsWithJson,
      });
    }

    const { message, history } = body;

    if (!env.GEMINI_API_KEY) {
      return new Response(JSON.stringify({ error: "مفتاح الـ GEMINI_API_KEY مفقود!" }), {
        status: 500,
        headers: corsWithJson,
      });
    }

    if (!message || typeof message !== "string" || !message.trim()) {
      return new Response(JSON.stringify({ error: "الرسالة فارغة" }), {
        status: 400,
        headers: corsWithJson,
      });
    }

    const previousUserQuestions = Array.isArray(history)
      ? history.filter(turn => turn?.role === "user").length
      : 0;

    const totalUserQuestions = previousUserQuestions + 1;

    if (totalUserQuestions > MAX_QUESTIONS_PER_SESSION) {
      return new Response(JSON.stringify({
        error: "لقد وصلت إلى الحد الأقصى للأسئلة في محادثة واحدة، لبدء محادثة جديدة الرجاء تحديث الصفحة."
      }), {
        status: 429,
        headers: corsWithJson,
      });
    }

    const safeHistory = normalizeHistory(history);

    const contents = [
      ...safeHistory,
      { role: "user", parts: [{ text: message.trim() }] }
    ];

    const reply = await callGeminiSafe({
      apiKey: env.GEMINI_API_KEY,
      contents,
    });

    return new Response(JSON.stringify({ reply }), {
      status: 200,
      headers: corsWithJson,
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error?.message || "خطأ داخلي" }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
}

/* ============================
   Helpers
============================ */

function normalizeHistory(history) {
  if (!Array.isArray(history)) return [];

  return history
    .slice(-MAX_HISTORY_TURNS)
    .map(turn => {
      const role = turn?.role === "assistant" ? "model" : turn.role;
      const parts = [];

      if (typeof turn?.parts === "string") {
        const t = turn.parts.trim();
        if (t) parts.push({ text: t });
      } else if (Array.isArray(turn?.parts)) {
        for (const p of turn.parts) {
          const t = typeof p === "string" ? p.trim() : p?.text?.trim?.() || "";
          if (t) parts.push({ text: t });
        }
      }

      if (!parts.length) return null;
      return { role, parts };
    })
    .filter(Boolean);
}

async function callGeminiSafe({ apiKey, contents }) {
  const url = GEMINI_URL(apiKey);

  const basePayload = {
    systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION_TEXT }] },
    generationConfig: {
      temperature: 0.0,
      topP: 0.95,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    }
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    // ✅ الطلب الأول
    const firstResp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...basePayload,
        contents
      }),
      signal: controller.signal
    });

    if (!firstResp.ok) {
      const data = await firstResp.json().catch(() => ({}));
      throw new Error(data?.error?.message || `خطأ HTTP: ${firstResp.status}`);
    }

    const firstData = await firstResp.json();
    const firstCandidate = firstData?.candidates?.[0];
    const firstParts = firstCandidate?.content?.parts;

    if (!Array.isArray(firstParts)) {
      throw new Error("لم يتم إرجاع نص من Gemini");
    }

    let fullText = firstParts
      .filter(p => p?.text)
      .map(p => p.text)
      .join("\n")
      .trim();

    if (!fullText) {
      throw new Error("لم يتم إرجاع نص من Gemini");
    }

    // ✅ إذا لم يتم القطع → نعيد الرد مباشرة
    if (firstCandidate?.finishReason !== "MAX_TOKENS") {
      clearTimeout(timeoutId);
      return fullText;
    }

    // ✅ إذا تم القطع → نطلب استكمال تلقائي
    const continueResp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...basePayload,
        contents: [
          ...contents,
          { role: "model", parts: [{ text: fullText }] },
          { role: "user", parts: [{ text: "Continue the previous answer exactly from where it stopped. Do not repeat anything." }] }
        ]
      }),
      signal: controller.signal
    });

    if (!continueResp.ok) {
      clearTimeout(timeoutId);
      return fullText; // إذا فشل الاستكمال نعيد الجزء الأول فقط
    }

    const continueData = await continueResp.json();
    const continueParts = continueData?.candidates?.[0]?.content?.parts;

    if (Array.isArray(continueParts)) {
      const continuation = continueParts
        .filter(p => p?.text)
        .map(p => p.text)
        .join("\n")
        .trim();

      if (continuation) {
        fullText += "\n" + continuation;
      }
    }

    clearTimeout(timeoutId);
    return fullText;

  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}
