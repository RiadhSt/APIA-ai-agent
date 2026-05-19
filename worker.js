export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    try {
      const { message, history } = await request.json();
      const apiKey = env.GEMINI_API_KEY;

      // 1. ضع هنا معرّفات الـ File IDs الخاصة بتقارير وكالة APIA التي قمت برفعها
      // يمكنك وضع معرف واحد أو أكثر داخل هذه المصفوفة
      const fileIds = [
        "files/ضع_هنا_معرف_الملف_الأول", 
        "files/ضع_هنا_معرف_الملف_الثاني"
      ];

      // تحويل الـ IDs إلى الصيغة التي يفهمها جوميناي
      const attachedFiles = fileIds.map(id => ({
        fileData: {
          fileUri: `https://generativelanguage.googleapis.com/v1beta/${id}`,
          mimeType: "application/pdf"
        }
      }));

      // 2. بناء التوجيهات الصارمة للخبير
      const systemInstruction = "أنت خبير وكالة APIA. أجب بدقة من الملفات المرفقة واستخدم الجداول للأرقام. رجاء عدم تبسيط المحتوى ولا اختصار الفقرات الالتزام الصارم بعدم تغيير أي حرف أو رقم.";

      // دمج الملفات مع السؤال الحالي للمستخدم
      const currentContent = {
        role: "user",
        parts: [
          ...attachedFiles,
          { text: message }
        ]
      };

      const contents = [...history, currentContent];
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?key=${apiKey}`;

      const response = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: contents,
          systemInstruction: { parts: [{ text: systemInstruction }] }
        })
      });

      return new Response(response.body, {
        headers: {
          ...corsHeaders,
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive"
        }
      });

    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  }
};
