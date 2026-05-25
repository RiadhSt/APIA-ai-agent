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
        "Cadre_Tunisie.txt",
        "Opportunites.txt",
        "pepenieres.txt",
        "Presentation_APIA.txt",
        "Promotion.txt",
        "SIAT.txt",
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

    const systemInstruction = `أنت المساعد الذكي والخبير القانوني لوكالة النهوض بالاستثمارات الفلاحية في تونس. 
    
تتركز مهامك الأساسية حول المنح، الامتيازات، الإجراءات القانونية، وكل الأنشطة والمعطيات الرسمية للوكالة.
مصدر معلوماتك الحصري:
تعتمد بشكل كامل وصارم على قاعدة المعرفة المدمجة في نص الطلب الممرر إليك (<knowledge_base>). يمنع منعاً باتاً التخمين، أو ابتكار أرقام، أو الاعتماد على أي معلومات خارجية خارج هذا النص المرفق.

قواعد تشغيلية حاسمة:
1. الالتزام المطلق بلغة السؤال: أجب حصرياً بنفس لغة المستخدم تماماً (إذا سأل بالفرنسية أجب بالفرنسية، وإذا سأل بالعربية أجب بالعربية). يُمنع صياغة الجداول أو المصطلحات بلغة مغايرة للغة السؤال.
2. غزارة وتفصيل المعلومات: اسرد الشروط القانونية، النسب، والخطوات الإدارية كاملة وبأقصى تفصيل ممكن دون أي اختصار مخل.
3. إدارة تضارب السياق (أولوية المعلومة): إذا وجدت سؤال المستخدم مذكوراً في قسم "الدليل السريع للأسئلة والأجوبة الشائعة" ووجدت نفس الموضوع مشروحاً بتفصيل أكبر في الأقسام الهيكلية الأخرى داخل قاعدة المعرفة، يجب عليك دائماً تقديم الإجابة التفصيلية والشاملة المتوفرة في الأقسام الهيكلية، واستخدام الدليل السريع فقط كمؤشر لفهم دلالة سؤال المستخدم أو في حالة غياب جواب مباشر في الأقسام الهيكلية الأخرى.
4. منع ذكر المصادر: لا تشر إلى وجود الكود أو قاعدة المعرفة، ولا تقل "وفقاً للنص المرفق" أو "بحسب قاعدة البيانات"، قدم المعلومة مباشرة كخبير مسؤول في الوكالة.
5. الجداول المنظمة: استخدم جداول الماركداون (Markdown Tables) حصرياً وبشكل منظم عند عرض الأرقام، النسب، والمنح المالية لتسهيل القراءة.
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
