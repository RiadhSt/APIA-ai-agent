export default {
  async fetch(request, env) {
    // تفعيل الـ CORS لتسمح لموقعك بالاتصال بالـ Worker دون قيود أمنية
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
      const apiKey = env.GEMINI_API_KEY; // يتم جلب مفتاح الأمان من إعدادات Cloudflare

      // ==========================================
      // 1. ضع روابط ملفات وتقارير وكالة APIA هنا بدقة
      // ==========================================
      const pdfUrls = [
        "https://apia-smartagri.pages.dev/reports/APIA_QA.pdf",
        "https://apia-smartagri.pages.dev/guide_de_l_investisseur-etranger.pdf",
        "https://apia-smartagri.pages.dev/Guide_Global.pdf", 
        "https://apia-smartagri.pages.dev/guide_societes_communautaires.pdf",
        "https://apia-smartagri.pages.dev/RAPPORT_2025_PUBLIQUE.pdf",
        "https://apia-smartagri.pages.dev/Rapport_Comite_Inv.pdf",
        "https://apia-smartagri.pages.dev/Site_web.pdf",  
      ];

      // تحويل الروابط إلى الهيكل البرمجي الذي يطلبه نموذج Gemini 2.5 Flash لقراءتها
      const attachedFiles = pdfUrls.map(url => ({
        fileData: {
          fileUri: url,
          mimeType: "application/pdf"
        }
      }));

      // 2. توجيهات النظام الصارمة (System Instructions) للحفاظ على المحتوى والأرقام
      const systemInstruction = "أنت خبير وكالة APIA. أجب بدقة من الملفات المرفقة واستخدم الجداول للأرقام. رجاء عدم تبسيط المحتوى ولا اختصار الفقرات الالتزام الصارم بعدم تغيير أي حرف أو رقم.";

      // دمج الملفات مع الرسالة الحالية للمستخدم
      const currentContent = {
        role: "user",
        parts: [
          ...attachedFiles,
          { text: message }
        ]
      };

      // دمج سجل المحادثة بالكامل (History) لضمان استمرار سياق الحوار
      const contents = [...history, currentContent];
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?key=${apiKey}`;

      // 3. الاتصال بـ Gemini بنظام البث (Streaming) لسرعة استجابة فائقة
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
