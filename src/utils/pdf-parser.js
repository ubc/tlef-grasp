const { PNG } = require("pngjs");
const llmService = require("../services/llm");

async function describeImage(base64Image, contextText) {
  try {
    const llmModule = await llmService.getLLMInstance();
    const prompt = `You are an educational assistant. Describe the following image in detail. Use the surrounding text to provide context. Focus on data, charts, diagrams, and educational concepts. Ignore decorative elements like logos or borders. Surrounding text context: "${contextText}"\nRespond ONLY in valid JSON format with a single key "description" containing your detailed description. If the image is merely decorative and contains no educational value, set the description to "decorative".`;
    
    const message = [
      { type: "text", text: prompt },
      { type: "image_url", image_url: { url: `data:image/png;base64,${base64Image}` } }
    ];
    
    const response = await llmModule.sendMessage(message);
    const rawContent = response.content || response.text || response.message || "{}";
    
    let description = "";
    try {
      const cleanContent = rawContent.replace(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/g, '$1').trim();
      const parsed = JSON.parse(cleanContent);
      description = parsed.description || "";
    } catch (e) {
      // Fallback if not perfectly parsed
      description = rawContent;
    }
    
    const usage = response.usage || { totalTokens: 0 };
    
    if (description.toLowerCase().includes("decorative") && description.length < 150) {
      console.log(`⚠️ Image ignored (classified as decorative)`);
      return { description: null, usage };
    }
    
    return { description, usage };
  } catch (error) {
    console.error("Error describing image:", error);
    return { description: null, usage: { totalTokens: 0 } };
  }
}

async function parsePdf(buffer) {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  
  // Workaround for standard fonts
  const standardFontDataUrl = new URL(
    'pdfjs-dist/standard_fonts/',
    'file://' + require.resolve('pdfjs-dist/package.json')
  ).href;

  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    standardFontDataUrl: standardFontDataUrl,
  });
  
  // Import LiteParse dynamically for ES module compatibility
  const { LiteParse } = await import("@llamaindex/liteparse");
  const parser = new LiteParse({ ocrEnabled: false });

  const pdfDocument = await loadingTask.promise;
  const numPages = pdfDocument.numPages;
  let fullText = "";
  let totalTokens = 0;

  console.log(`Parsing PDF with ${numPages} pages...`);

  for (let i = 1; i <= numPages; i++) {
    const page = await pdfDocument.getPage(i);
    const textContent = await page.getTextContent();
    let pageText = textContent.items.map(item => item.str).join(" ").replace(/\s+/g, " ");
    
    let complexFallbackNeeded = false;
    let extractedImages = [];
    
    try {
      const ops = await page.getOperatorList();
      for (let j = 0; j < ops.fnArray.length; j++) {
        if (ops.fnArray[j] === pdfjsLib.OPS.paintImageXObject) {
          try {
            const imgName = ops.argsArray[j][0];
            
            const img = await new Promise((resolve) => {
              const timeout = setTimeout(() => {
                console.warn(`Timeout waiting for image object ${imgName} on page ${i}. Triggering full-page fallback...`);
                resolve(null);
              }, 2000); 

              try {
                page.objs.get(imgName, (data) => {
                  clearTimeout(timeout);
                  resolve(data);
                });
              } catch (e) {
                clearTimeout(timeout);
                resolve(null);
              }
            });
            
            if (!img) {
               complexFallbackNeeded = true;
               break; 
            }
            
            // Filter out small images (likely decorative)
            if (img && img.width > 100 && img.height > 100) {
              const png = new PNG({ width: img.width, height: img.height });
              
              if (img.data.length === img.width * img.height * 4) {
                png.data = Buffer.from(img.data);
              } else if (img.data.length === img.width * img.height * 3) {
                for (let k = 0, p = 0; k < img.data.length; k += 3, p += 4) {
                  png.data[p] = img.data[k];
                  png.data[p + 1] = img.data[k + 1];
                  png.data[p + 2] = img.data[k + 2];
                  png.data[p + 3] = 255;
                }
              } else if (img.data.length === img.width * img.height) {
                for (let k = 0, p = 0; k < img.data.length; k++, p += 4) {
                  png.data[p] = img.data[k];
                  png.data[p + 1] = img.data[k];
                  png.data[p + 2] = img.data[k];
                  png.data[p + 3] = 255;
                }
              } else {
                 console.warn("Unsupported image format on page", i);
                 complexFallbackNeeded = true;
                 break;
              }
              
              const base64 = PNG.sync.write(png).toString('base64');
              extractedImages.push(base64);
            }
          } catch (e) {
             console.warn(`Error extracting image natively: ${e.message}. Triggering fallback...`);
             complexFallbackNeeded = true;
             break;
          }
        }
      }
    } catch (e) {
      console.warn(`Could not check for images on page ${i}:`, e.message);
    }
    
    if (complexFallbackNeeded) {
      try {
        console.log(`📸 Complex images detected on page ${i}. Using LiteParse to snapshot the full page...`);
        const screenshots = await parser.screenshot(Buffer.from(buffer), [i]);
        
        if (screenshots && screenshots.length > 0) {
          const base64 = screenshots[0].imageBuffer.toString('base64');
          const contextText = pageText.substring(0, 500); 
          
          const result = await describeImage(base64, contextText);
          
          if (result && result.usage) {
             totalTokens += result.usage.totalTokens || result.usage.total_tokens || 0;
          }
          
          if (result && result.description) {
            console.log(`✅ Page ${i} visual content described successfully: "${result.description.substring(0, 50)}..."`);
            pageText += `\n\n[Visual Content Description: ${result.description}]\n\n`;
          }
        }
      } catch (e) {
        console.warn(`Error generating screenshot for page ${i}:`, e.message);
      }
    } else if (extractedImages.length > 0) {
      console.log(`📸 Successfully extracted ${extractedImages.length} individual image(s) from page ${i}...`);
      for (const base64 of extractedImages) {
        const contextText = pageText.substring(0, 500);
        const result = await describeImage(base64, contextText);
        
        if (result && result.usage) {
          totalTokens += result.usage.totalTokens || result.usage.total_tokens || 0;
        }
        
        if (result && result.description) {
          console.log(`✅ Image described successfully: "${result.description.substring(0, 50)}..."`);
          pageText += `\n\n[Image Description: ${result.description}]\n\n`;
        }
      }
    }
    
    fullText += `Page ${i}:\n${pageText}\n\n`;
  }
  
  return { content: fullText.trim(), tokenUsage: totalTokens };
}

module.exports = { parsePdf };
