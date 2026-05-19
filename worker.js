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

      const pdfUrls = [
        "https://apia-smartagri.pages.dev/reports/APIA_QA.pdf",
        "https://apia-smartagri.pages.dev/reports/guide_de_l_investisseur-etranger.pdf",
        "https://apia-smartagri.pages.dev/reports/Guide_Global.pdf", 
        "https://apia-smartagri.pages.dev/reports/guide_societes_communautaires.pdf",
        "https://apia-smartagri.pages.dev/reports/RAPPORT_2025_PUBLIQUE.pdf",
        "https://apia-smartagri.pages.dev/reports/Rapport_Comite_Inv.pdf",
        "https://apia-smartagri.pages.dev/reports/Site_web.pdf",  
      ];


      
      // التصحيح البرمجي الصارم لهيكلية الملفات عن بعد لقراءتها بسلاسة
      const attachedFiles = pdfUrls.map(url => ({
        inlineData: {
          mimeType: "application/pdf",
          data: url // تمرير الرابط المباشر كـ Source
        }
      }));

      const systemInstruction = "أنت خبير وكالة APIA. أجب بدقة من الملفات المرفقة واستخدم الجداول للأرقام. رجاء عدم تبسيط المحتوى ولا اختصار الفقرات الالتزام الصارم بعدم تغيير أي حرف أو رقم.";

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
