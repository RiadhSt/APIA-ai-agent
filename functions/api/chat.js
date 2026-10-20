import { myKnowledgeBase } from './knowledge.js';

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const MAX_HISTORY_TURNS = 3;
const MAX_QUESTIONS_PER_SESSION = 5;
const MAX_OUTPUT_TOKENS = 2000;
const TIMEOUT_MS = 28000;

const GEMINI_URL = (apiKey) =>
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

// تم إضافة تعليمات التصنيف فقط في آخر الـ System Instruction
const SYSTEM_INSTRUCTION_TEXT = `You are the official Smart Assistant for the Agricultural Investment Promotion Agency (APIA) in Tunisia.

CRITICAL RULES:
1. LANGUAGE MATCH: Reply in the same language as the user query.
2. STRICT CONTEXT FOCUS: Answer ONLY using the provided knowledge below.
3. Provide complete structured answer.
4. MARKDOWN TABLES: Format ALL numbers, percentages, and financial grants exclusively in clear Markdown tables. Do not write numbers in raw text.
5. When using Markdown tables, always complete the full table including all rows.
6. Do NOT invent information.
7. CATEGORY TAGGING: At the very end of your response, output the single most relevant category for the user query inside triply angle brackets like this: <<<منح_الصنف_أ>>>.
Choose EXACTLY one category from this list:
[منح_الصنف_أ, منح_الصنف_ب, قروض_عقارية, تحكم_تكنولوجي, تنمية_جهوية, صيد_بحري, خدمات_المخاطب_الوحيد, تكوين_ومساندة, عام]

<knowledge_base>
${myKnowledgeBase}
</knowledge_base>`.trim();

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // 📊 مسار الإحصائيات لمتابعة الأسئلة والمواضيع الأكثر تكراراً
  if (url.pathname.endsWith("/analytics") || url.pathname.endsWith("/analytics/")) {
    return handleAnalytics(env);
  }

  return new Response(JSON.stringify({ message: "APIA Worker Active" }), {
    status: 200,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  try {
    const corsWithJson = { ...CORS_HEADERS, "Content-Type": "application/json" };

    // مسار معالجة الإحصائيات عبر POST إذا لزم الأمر
    if (url.pathname.endsWith("/analytics")) {
      return handleAnalytics(env);
    }

    const body = await request.json().catch(() => null);

    if (!body) {
      return new Response(JSON.stringify({ error: "Body JSON غير صالح" }), {
        status: 400,
        headers: corsWithJson,
      });
    }

    const { message, history, sessionId } = body;

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

    const rawReply = await callGeminiSafe({
      apiKey: env.GEMINI_API_KEY,
      contents,
    });

    // 🔍 استخراج التصنيف وتجهيز الرد النظيف
    let category = "عام";
    let cleanReply = rawReply;

    const categoryMatch = rawReply.match(/<<<([^>]+)>>>/);
    if (categoryMatch) {
      category = categoryMatch[1].trim();
      cleanReply = rawReply.replace(/<<<([^>]+)>>>/, "").trim();
    }

    // 💾 تسجيل البيانات في قاعدة البيانات D1 في الخلفية دون تعطيل أو إبطاء الاستجابة
    if (env.DB) {
      context.waitUntil(
        logToD1(env.DB, sessionId || "session_anon", message.trim(), cleanReply, category)
      );
    }

    return new Response(JSON.stringify({ reply: cleanReply, category }), {
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
    Logging & Analytics Helpers
============================ */

async function logToD1(db, sessionId, query, response, category) {
  try {
    await db.prepare(
      `INSERT INTO conversations (session_id, user_query, bot_response, category)
       VALUES (?, ?, ?, ?)`
    ).bind(sessionId, query, response, category).run();
  } catch (e) {
    console.error("D1 Logging Error:", e);
  }
}

async function handleAnalytics(env) {
  const corsWithJson = { ...CORS_HEADERS, "Content-Type": "application/json" };
  
  if (!env.DB) {
    return new Response(JSON.stringify({ error: "قاعدة البيانات D1 غير مرتبطة بـ Worker" }), {
      status: 500,
      headers: corsWithJson
    });
  }

  try {
    const { results } = await env.DB.prepare(
      `SELECT category, COUNT(*) as count 
       FROM conversations 
       GROUP BY category 
       ORDER BY count DESC`
    ).all();

    const totalQueries = results.reduce((sum, item) => sum + item.count, 0);
    
    const formattedTopics = results.map(item => ({
      category: item.category,
      count: item.count,
      percentage: totalQueries > 0 ? ((item.count / totalQueries) * 100).toFixed(1) + "%" : "0%"
    }));

    return new Response(JSON.stringify({
      total_conversations: totalQueries,
      top_topics: formattedTopics
    }), {
      status: 200,
      headers: corsWithJson
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: corsWithJson
    });
  }
}

/* ============================
    Helpers (Original & Unchanged)
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
