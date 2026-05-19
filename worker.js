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

    try {
      const { message, history } = await request.json();
      const apiKey = env.GEMINI_API_KEY;

      if (!apiKey) throw new Error("مفتاح الـ API Key مفقود!");

      // رابط مستودع البوت الفعلي الخاص بك
      const botUrl = "https://apia1ai.apia.workers.dev"; 

      // سنركز على الملفات الأكثر أهمية لضمان عدم تجاوز حدود حجم الذاكرة في الـ Worker
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

      // تحميل الملفات وتحويلها ديناميكياً إلى Base64 لتخطي حظر Google API
      for (const url of targetFiles) {
        try {
          const fileResponse = await fetch(url);
          if (fileResponse.ok) {
            const arrayBuffer = await fileResponse.arrayBuffer();
            // تحويل الـ ArrayBuffer إلى صيغة Base64 النظيفة
            const base64Data = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
            
            attachedFilesParts.push({
              inlineData: {
                mimeType: "application/pdf",
                data: base64Data
              }
            });
          }
        } catch (e) {
          // تجاوز أي ملف يفشل في التحميل لضمان استمرار البوت في العمل
        }
      }

      const systemInstruction = "أنت خبير وكالة APIA. أجب بدقة من الملفات المرفقة واستخدم الجداول للأرقام دون تغيير أو اختصار.";

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
        throw new Error(`رفض الـ API الطلب برمز خطأ: ${response.status}`);
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
