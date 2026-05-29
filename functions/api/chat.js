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
      return new Response(JSON.stringify({ error: "مفتاح الـ GEMINI_API_KEY مفقود!" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // تنظيف وتجهيز الـ History الممرر من الواجهة
    const safeHistory = (history || []).map(turn => ({
      role: turn.role === "assistant" ? "model" : turn.role,
      parts: (typeof turn.parts === "string") ? [{ text: turn.parts }] : turn.parts
    }));

    const attachedFilesParts = [];

    // تبسيط الـ System Instruction إلى لغة إنجليزية مباشرة لتقليل استهلاك السيرفر والمعالجة
    const systemInstruction = `You are the official Smart Assistant for the Agricultural Investment Promotion Agency (APIA) in Tunisia.

CRITICAL RULES:
1. LANGUAGE MATCH: Reply in the same language as the user query (Arabic or French or English). Never mix languages.
2. STRICT CONTEXT FOCUS: Answer ONLY the specific topic raised in the user's question. Provide all technical figures, percentages, and steps related exclusively to that topic. NEVER drift into other types of grants, secondary regulations, or unrelated laws unless the user explicitly asks for them.
3. CONCISE YET POWERFUL: Be highly direct, official, and professional. Avoid introductory filler, extra prose, or general overviews. Deliver the required exact data immediately.
4. MARKDOWN TABLES: Format numbers, percentages, and financial grants exclusively in clear Markdown tables.

OFFICIAL DATABASE TO USE:
<knowledge_base>
${myKnowledgeBase}
</knowledge_base>`;    

    // إرسال سؤال المستخدم نظيفاً تماماً دون أي إضافات تسبب تشتت أو معالجة مزدوجة
    const contents = [
      ...safeHistory,
      { 
        role: "user", 
        parts: [
          ...attachedFilesParts,
          { text: message }
        ] 
      }
    ];

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const response = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: contents,
        systemInstruction: { parts: [{ text: systemInstruction }] },
        generationConfig: {
          temperature: 0.0, // صفر مطلق لضمان الثبات اللغوي الفوري ومنع التشتت والهلوسة
          topP: 0.95
        }
      })
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      return new Response(JSON.stringify({ error: data.error?.message || "خطأ من سيرفر جوجل" }), {
        status: response.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const data = await response.json();
    const candidate = data.candidates?.[0];
    let botReply = "";

    if (candidate && candidate.content && candidate.content.parts) {
      const textParts = candidate.content.parts
        .filter(part => !part.thought && part.text)
        .map(part => part.text);
        
      botReply = textParts.join("\n");
    }

    if (!botReply) {
      botReply = "لم أتمكن من صياغة إجابة.";
    }
        
    return new Response(JSON.stringify({ reply: botReply }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
}
