export default {
  async fetch(request, env) {
    // تفعيل الـ CORS لتسمح لموقعك المستضاف على Cloudflare Pages بالاتصال بالـ Worker دون قيود
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
      const apiKey = env.GEMINI_API_KEY; // يتم ضبطه بأمان في إعدادات Cloudflare

      // 1. جلب قائمة كافة ملفات الـ PDF الضخمة المرفوعة مسبقاً على حسابك تلقائياً دون تذكر الـ IDs
      const filesResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/files?key=${apiKey}`, {
        method: "GET"
      });
      const filesData = await filesResponse.json();
      
      // استخراج معرّفات الملفات لتمريرها مع السياق
      let attachedFiles = [];
      if (filesData.files && filesData.files.length > 0) {
        attachedFiles = filesData.files.map(f => ({ fileUri: f.uri }));
      }

      // 2. بناء هيكل طلب المحادثة لـ Gemini 2.5 Flash
      const systemInstruction = "أنت خبير وكالة النهوض بالاستثمارات الفلاحية. أجب بدقة من الملفات المرفقة واستخدم الجداول للأرقام. رجاء تبسيط المحتوى ولا اختصار الفقرات الالتزام الصارم بعدم تغيير أي حرف أو رقم.";
      
      // تجهيز الرسالة الحالية ودمج الملفات المرفقة معها تلقائياً إن وجدت
      const currentContent = {
        role: "user",
        parts: [
          ...attachedFiles,
          { text: message }
        ]
      };

      // دمج سجل المحادثة الحالي (History) لضمان استمرار السياق
      const contents = [...history, currentContent];

      // 3. الاتصال بـ Gemini بنظام البث (Streaming) لسرعة استجابة فائقة
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?key=${apiKey}`;
      
      const response = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: contents,
          systemInstruction: { parts: [{ text: systemInstruction }] }
        })
      });

      // تحويل استجابة جوميناي إلى Stream متدفق مباشرة إلى واجهة المستخدم
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