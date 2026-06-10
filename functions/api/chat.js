import { myKnowledgeBase } from './knowledge.js';

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const MAX_HISTORY_TURNS = 3; // أقل تاريخ ممكن لتقليل الضغط
const MAX_QUESTIONS_PER_SESSION = 5;
const MAX_OUTPUT_TOKENS = 1500; // رفع لمنع قطع الجداول
const TIMEOUT_MS = 28000; // أقل من 30 ثانية لتفادي قطع Cloudflare

const GEMINI_URL = (apiKey) =>
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

const SYSTEM_INSTRUCTION_TEXT = `You are the official Smart Assistant for the Agricultural Investment Promotion Agency (APIA) in Tunisia.

CRITICAL RULES:
1. LANGUAGE MATCH: Reply in the same language as the user query.
2. STRICT CONTEXT FOCUS: Answer ONLY using the provided knowledge below.
3. Provide complete structured answer.
4. When using Markdown tables, always complete the full table including all rows.
5. Do NOT invent information.

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

    // ✅ حساب عدد الأسئلة
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

  const payload = {
    contents,
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
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      const msg =
        resp.status === 503 ? "سيرفر Google غير متاح مؤقتاً"
        : resp.status === 429 ? "الخدمة مشغولة، حاول بعد لحظة"
        : data?.error?.message || `خطأ HTTP: ${resp.status}`;

      throw new Error(msg);
    }

    const data = await resp.json();
    const parts = data?.candidates?.[0]?.content?.parts;

    if (!Array.isArray(parts)) {
      throw new Error("لم يتم إرجاع نص من Gemini");
    }

    const text = parts
      .filter(p => p?.text)
      .map(p => p.text)
      .join("\n")
      .trim();

    if (!text) {
      throw new Error("لم يتم إرجاع نص من Gemini");
    }

    return text;

  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}
