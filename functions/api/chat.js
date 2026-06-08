import { myKnowledgeBase } from './knowledge.js';

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// ✅ حد أقصى لعدد أدوار المحادثة لتقليل التوكنز
const MAX_HISTORY_TURNS = 4;

// ✅ حد أقصى لعدد الأسئلة في المحادثة الواحدة
const MAX_QUESTIONS_PER_SESSION = 5;

// ✅ تحكم في حجم الرد
const MAX_OUTPUT_TOKENS = 1100;

const GEMINI_URL = (apiKey) =>
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

// ✅ تعليمات النظام
const SYSTEM_INSTRUCTION_TEXT = `You are the official Smart Assistant for the Agricultural Investment Promotion Agency (APIA) in Tunisia.

CRITICAL RULES:
1. LANGUAGE MATCH: Reply in the same language as the user query (Arabic or French or English). Never mix languages.
2. STRICT CONTEXT FOCUS: Answer ONLY the specific topic raised in the user's question. Provide all technical figures, percentages, and steps related exclusively to that topic. NEVER drift into other types of grants, secondary regulations, or unrelated laws unless the user explicitly asks for them.
3. CONCISE YET POWERFUL: Be highly direct, official, and professional. Avoid introductory filler, extra prose, or general overviews. Deliver the required exact data immediately.
4. MARKDOWN TABLES: Format numbers, percentages, and financial grants exclusively in clear Markdown tables.

OFFICIAL DATABASE TO USE:
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

    if (typeof message !== "string" || !message.trim()) {
      return new Response(JSON.stringify({ error: "الرسالة فارغة" }), {
        status: 400,
        headers: corsWithJson,
      });
    }

    // ✅ حساب عدد أسئلة المستخدم
    const userQuestionCount = Array.isArray(history)
      ? history.filter(turn => turn?.role === "user").length
      : 0;

    if (userQuestionCount >= MAX_QUESTIONS_PER_SESSION) {
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

    const result = await callGeminiWithRetry({
      apiKey: env.GEMINI_API_KEY,
      contents,
      systemInstructionText: SYSTEM_INSTRUCTION_TEXT,
    });

    return new Response(JSON.stringify({ reply: result }), {
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
      } else {
        const t = turn?.parts?.text?.trim?.() || "";
        if (t) parts.push({ text: t });
      }

      if (!parts.length) return null;

      return { role, parts };
    })
    .filter(Boolean);
}

async function callGeminiWithRetry({ apiKey, contents, systemInstructionText }) {
  const url = GEMINI_URL(apiKey);

  const payload = {
    contents,
    systemInstruction: { parts: [{ text: systemInstructionText }] },
    generationConfig: {
      temperature: 0.0,
      topP: 0.95,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    }
  };

  const maxRetries = 2;
  let lastErr = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutMs = 24000;
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!resp.ok) {
        if ((resp.status === 429 || resp.status === 503) && attempt < maxRetries) {
          await backoff(attempt);
          continue;
        }

        const data = await resp.json().catch(() => ({}));
        const msg =
          data?.error?.message ||
          (resp.status === 503 ? "سيرفر Google غير متاح مؤقتاً" : `خطأ HTTP: ${resp.status}`);

        throw new Error(msg);
      }

      const data = await resp.json();

      const parts = data?.candidates?.[0]?.content?.parts;
      const botReply = Array.isArray(parts)
        ? parts.filter(p => !p?.thought && p?.text).map(p => p.text).join("\n").trim()
        : "";

      if (!botReply) throw new Error("لم يتم إرجاع نص من Gemini");

      return botReply;

    } catch (err) {
      lastErr = err;

      if (attempt < maxRetries) {
        await backoff(attempt);
        continue;
      }
    }
  }

  throw lastErr || new Error("خطأ غير معروف");
}

function backoff(attempt) {
  const ms = 1200 * (attempt + 1);
  return new Promise(r => setTimeout(r, ms));
}
