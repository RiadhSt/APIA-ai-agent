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

      if (!apiKey) {
        throw new Error("مفتاح الـ GEMINI_API_KEY مفقود في إعدادات Cloudflare!");
      }

      // رابط مستودع البوت الفعلي والمباشر الخاص بك
      const botUrl = "https://apia1ai.apia.workers.dev"; 

      // التركيز على الملفات الحيوية لضمان عدم تجاوز الذاكرة والـ Quota
      const targetFiles = [
        `${botUrl}/reports/APIA_QA.pdf`,
        `${botUrl}/reports/guide_de_l_investisseur-etranger.pdf`,
        `${botUrl}/reports/Guide_Global.pdf`, 
        `${botUrl}/reports/guide_societes_communautaires.pdf`,
        `${botUrl}/reports/RAPPORT_2025_PUBLIQUE.pdf`,
        `${botUrl}/reports/Rapport_Comite_Inv.pdf`,
        `${botUrl}/reports/Site_web.pdf`
      ];

      const attachedFilesParts = [];

      // تحويل الملفات برمجياً إلى Base64 لتخطي حظر السيرفرات والأمان
      for (const url of targetFiles) {
        try {
          const fileResponse = await fetch(url);
          if (fileResponse.ok) {
            const arrayBuffer = await fileResponse.arrayBuffer();
            
            // تحويل آمن ومتوافق مع خوادم كلوفلير للـ ArrayBuffer إلى Base64
            const bytes = new Uint8Array(arrayBuffer);
            let binary = "";
            for (let i = 0; i < bytes.byteLength; i++) {
              binary += String.fromCharCode(bytes[i]);
            }
            const base64Data = btoa(binary);
            
            attachedFilesParts.push({
              inlineData: {
                mimeType: "application/pdf",
                data: base64Data
              }
            });
          }
        } catch (e) {
          // تجاوز أي ملف يفشل في التحميل لضمان عدم توقف البوت
        }
      }

      const systemInstruction = "أنت خبير وكالة APIA. أجب بدقة من الملفات المرفقة واستخدم الجداول للأرقام. الالتزام الصارم بعدم تبسيط المحتوى أو تغيير أي أرقام.";

      const currentContent = {
        role: "user",
        parts: [
          ...attachedFilesParts,
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
        const errorText = await response.text();
        throw new Error(`رفض الـ API الخاص بجوجل الطلب: ${errorText}`);
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
