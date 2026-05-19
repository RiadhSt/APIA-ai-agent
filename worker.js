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
        throw new Error("مفتاح الـ GEMINI_API_KEY مفقود في إعدادات كلوفلير!");
      }

      // أسماء الملفات كما هي موجودة في مستودع GitHub الخاص بالبوت
      const filePaths = [
        "reports/APIA_QA.pdf",
        "reports/guide_de_l_investisseur-etranger.pdf",
        "reports/Guide_Global.pdf", 
        "reports/guide_societes_communautaires.pdf",
        "reports/RAPPORT_2025_PUBLIQUE.pdf",
        "reports/Rapport_Comite_Inv.pdf",
        "reports/Site_web.pdf"
      ];

      const attachedFilesParts = [];

      // قراءة الملفات مباشرة من الأصول الثابتة للمشروع (Assets)
      for (const path of filePaths) {
        try {
          // جلب الملف محلياً من البيئة المشتركة لـ Cloudflare Pages
          const fileObject = await env.ASSETS.get(path);
          if (fileObject) {
            const arrayBuffer = await fileObject.arrayBuffer();
            
            // تحويل الملف البرمجي الثنائي إلى صيغة Base64 ليفهمها جوميناي
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
          // تجاوز أي ملف يحدث فيه خلل في القراءة لضمان استقرار البوت
        }
      }

      const systemInstruction = "أنت خبير وكالة APIA. أجب بدقة من الملفات المرفقة واستخدم الجداول للأرقام. الالتزام الصارم بعدم تبسيط المحتوى أو تغيير أي أرقام أو فقرات.";

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
        throw new Error(`رفض خادم جوميناي الطلب: ${errorText}`);
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
