export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*", // يسمح للموقع الرئيسي بالاتصال به
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

      if (!apiKey) {
        throw new Error("مفتاح الـ API Key مفقود في المتغيرات!");
      }

      // =========================================================
      // ضع هنا رابط البوت الفعلي من الخطوة 1 (وليس الموقع الرئيسي)
      // =========================================================
      const botUrl = "https://apia1ai.apia.workers.dev/"; 

      const pdfUrls = [
        `${botUrl}/reports/APIA_QA.pdf`,
        `${botUrl}/reports/guide_de_l_investisseur-etranger.pdf`,
        `${botUrl}/reports/Guide_Global.pdf`, 
        `${botUrl}/reports/guide_societes_communautaires.pdf`,
        `${botUrl}/reports/RAPPORT_2025_PUBLIQUE.pdf`,
        `${botUrl}/reports/Rapport_Comite_Inv.pdf`,
        `${botUrl}/reports/Site_web.pdf`
      ];

      const attachedFiles = pdfUrls.map(url => ({
        inlineData: {
          mimeType: "application/pdf",
          data: url
        }
      }));

      const systemInstruction = "أنت خبير وكالة النهوض بالاستثمارات الفلاحية التونسية. أجب بدقة من الملفات المرفقة واستخدم الجداول للأرقام. رجاء عدم تبسيط المحتوى ولا اختصار الفقرات الالتزام الصارم بعدم تغيير أي حرف أو رقم.";

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

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`خطأ من خادم جوميناي: ${errText}`);
      }

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
