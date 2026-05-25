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
      parts: turn.parts
    }));

    const attachedFilesParts = [];

    if (safeHistory.length === 0) {
      const fileNames = [
        "APIA_QA.pdf",
        "guide_de_l_investisseur-etranger.pdf",
        "guide_societes_communautaires.pdf",
        "RAPPORT_2025_PUBLIQUE.pdf",
        "Rapport_Comite_Inv.pdf",
        "Inciat_Budg.csv",       
        "Incit_Finac.pdf",
        "Composantes.csv",
        "Declarations.txt",
        "Procedure_Declaration.txt",
        "Foncier.txt",
        "Foncier 2.csv",
        "DOA.txt",
        "DOA_Delais.txt",
        "Calcul_Prime.txt",
        "Deb_Prime.txt",
        "Liste_Inv.txt",
        "Comite_Octroi.txt",
        "Actualisation_ADI_DOA.txt",
        "Categorie.txt",
        "Definitions.txt",
        "Loi_Inv.txt",
        "Deb_Prime_2.txt",
        "Normes.pdf",
        "Cartes_Services.pdf",
        "APIA_Knowledge_Base.txt",
        "Etude.pdf"
      ];

      const baseUrl = new URL(request.url).origin;
      const fetchPromises = fileNames.map(async (fileName) => {
        try {
          const fileUrl = `${baseUrl}/reports/${fileName}`;
          const fileResponse = await fetch(fileUrl);
          
          if (fileResponse.ok) {
            // 1. تحديد نوع الـ MimeType ديناميكياً بناءً على الامتداد
            let mimeType = "application/pdf";
            const ext = fileName.split('.').pop().toLowerCase();
            
            if (ext === "txt") {
              mimeType = "text/plain";
            } else if (ext === "csv") {
              mimeType = "text/csv";
            }

            // 2. قراءة الملفات النصية مباشرة دون الحاجة لترميز الـ Base64 المعقد الخاص بالملفات الثنائية
            if (ext === "txt" || ext === "csv") {
              const textData = await fileResponse.text();
              return {
                inlineData: {
                  mimeType: mimeType,
                  data: btoa(unescape(encodeURIComponent(textData))) // ترميز النصوص البرمجية بشكل آمن يدعم العربية
                }
              };
            } else {
              // 3. قراءة ملفات الـ PDF الثنائية وترميزها بالشكل المعتاد
              const arrayBuffer = await fileResponse.arrayBuffer();
              const bytes = new Uint8Array(arrayBuffer);
              let binary = "";
              for (let i = 0; i < bytes.byteLength; i += 8000) {
                const chunk = bytes.subarray(i, i + 8000);
                binary += String.fromCharCode.apply(null, chunk);
              }
              return {
                inlineData: {
                  mimeType: mimeType,
                  data: btoa(binary)
                }
              };
            }
          }
        } catch (e) {
          console.error(`خطأ أثناء قراءة الملف ${fileName}:`, e);
        }
        return null;
      });

      const resolvedFiles = await Promise.all(fetchPromises);
      for (const file of resolvedFiles) {
        if (file) attachedFilesParts.push(file);
      }
    }

    const systemInstruction = `
أنت المساعد الذكي لوكالة النهوض بالاستثمارات الفلاحية في تونس. تتركز مهامك الأساسية حول المنح، الامتيازات، والإجراءات القانونية، بالإضافة إلى كل الأنشطة، المعطيات، والخدمات الرسمية المنشورة على موقع الوكالة (مثل قائمة المعارض، الصالونات، والأخبار الاستشرافية). أجب دائماً بناءً على الوثائق المسترجعة مهما كان نوع النشاط الفلاحي أو الإعلامي المطلوب.
أجب بدقة وموثوقية عالية، وبتفصيل كامل دون اختصار مخل بالاستناد إلى التقارير والملفات المرفوعة في بداية الجلسة.

قواعد تشغيلية حاسمة:
1. الالتزام المطلق بلغة السؤال: أجب حصرياً بنفس لغة المستخدم تماماً. يمنع صياغة الجداول أو العناوين بالإنجليزية طالما أن السؤال عربي.
2. غزارة المعلومات: اسرد الشروط القانونية، النسب، والخطوات الإدارية كاملة دون اختصار مخل.
3. منع ذكر المصادر: لا تقل "وفقاً للملف المرفق"، قدم المعلومة مباشرة كخبير مسؤول.
4. الجداول المنظمة: استخدم جداول الماركداون (Markdown Tables) حصرياً عند عرض الأرقام والمنح المالية.
`;    

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
          temperature: 0.2,
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
    const botReply = data.candidates?.[0]?.content?.parts?.[0]?.text || "لم أتمكن من صياغة إجابة.";
    
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
