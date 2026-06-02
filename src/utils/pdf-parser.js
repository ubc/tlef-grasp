const sharp = require("sharp");
const llmService = require("../services/llm");
const fs = require("fs").promises;
const path = require("path");

async function describeImage(base64Image, contextText) {
  try {
    const llmModule = await llmService.getLLMInstance();
    const prompt = `You are an expert data extractor. You MUST precisely transcribe EVERY single word, number, equation, and label visible in the image. Do NOT skip any text, even if it is a large heading, handwritten, or appears to be a definition. Treat the image as the single source of truth. After transcribing all text exactly as written, describe the visual relationships, diagrams, or charts. Surrounding text context is provided for understanding, not as an excuse to skip text: "${contextText}"\nRespond ONLY in valid JSON format with a single key "description" containing your full transcription and description. If the image is entirely decorative, set the description to "decorative".`;
    
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
      description = rawContent;
    }
    
    const usage = response.usage || { totalTokens: 0 };
    if (description.toLowerCase().includes("decorative") && description.length < 150) {
      return { description: null, usage };
    }
    return { description, usage };
  } catch (error) {
    console.error("Error describing image:", error);
    return { description: null, usage: { totalTokens: 0 } };
  }
}

/**
 * Clusters individual OCR items into cohesive "image blocks" based on spatial proximity.
 */
function clusterOcrItems(items, threshold = 60) {
  if (items.length === 0) return [];
  const clusters = [];
  for (const item of items) {
    let assigned = false;
    for (const cluster of clusters) {
      const b = cluster.bbox;
      const isClose = !(item.x > b.x + b.w + threshold || 
                        item.x + item.width < b.x - threshold || 
                        item.y > b.y + b.h + threshold ||
                        item.y + item.height < b.y - threshold);
      if (isClose) {
        cluster.items.push(item);
        const x1 = Math.min(b.x, item.x);
        const y1 = Math.min(b.y, item.y);
        const x2 = Math.max(b.x + b.w, item.x + item.width);
        const y2 = Math.max(b.y + b.h, item.y + item.height);
        cluster.bbox = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
        assigned = true;
        break;
      }
    }
    if (!assigned) {
      clusters.push({ items: [item], bbox: { x: item.x, y: item.y, w: item.width, h: item.height } });
    }
  }
  return clusters;
}

/**
 * Pure Node.js Hybrid Parser:
 * 1. LiteParse for layout analysis and local OCR detection.
 * 2. Sharp for targeted image extraction.
 * 3. VLM (OpenAI) as a "Visual Healer" for equations and diagrams.
 * 4. NFKC Normalization for robust searchability.
 */
async function parsePdf(buffer) {
  const { LiteParse } = await import("@llamaindex/liteparse");
  const parser = new LiteParse({ ocrEnabled: true });

  console.log(`Starting Pure Node PDF extraction...`);
  
  try {
    const result = await parser.parse(buffer);
    let fullText = "";
    let totalTokens = 0;

    for (const page of result.pages) {
      const pageNum = page.pageNum;
      let pageText = page.text;
      
      const ocrItems = page.textItems.filter(item => item.fontName === 'OCR');
      
      // The visual path is ONLY triggered if LiteParse explicitly found an image region.
      const hasImages = ocrItems.length > 0;

      if (hasImages) {
        console.log(`📸 Visual content detected on page ${pageNum}. Processing...`);
        try {
          const screenshots = await parser.screenshot(buffer, [pageNum]);
          if (screenshots && screenshots.length > 0) {
            const pageImage = screenshots[0];
            const scaleX = pageImage.width / page.width;
            const scaleY = pageImage.height / page.height;
            const padding = 50;

            let regions = [];
            let clusters = [];
            
            if (ocrItems.length > 0) {
              clusters = clusterOcrItems(ocrItems);
            }

            if (clusters.length === 1) {
              // Page has 1 image -> Extract individually (full res, cheaper)
              // We use a generous padding (e.g., 50px) below to prevent cutting off handwritten text 
              // that might sit just outside the strict OCR bounding box.
              regions = [{
                bbox: clusters[0].bbox,
                items: clusters[0].items,
                isFullPage: false
              }];
            } else {
              // Page has 2+ images (or 0 as fallback) -> Screenshot the whole page (context wins)
              regions = [{
                bbox: { x: 0, y: 0, w: page.width, h: page.height },
                items: ocrItems,
                isFullPage: true
              }];
            }

            for (const region of regions) {
              const b = region.bbox;
              const p = region.isFullPage ? 0 : padding;
              
              const crop = {
                left: Math.round(Math.max(0, (b.x - p) * scaleX)),
                top: Math.round(Math.max(0, (b.y - p) * scaleY)),
                width: Math.round(Math.min(pageImage.width, (b.w + p * 2) * scaleX)),
                height: Math.round(Math.min(pageImage.height, (b.h + p * 2) * scaleY))
              };

              if (!region.isFullPage && (crop.width < 50 || crop.height < 50)) continue;

              try {
                const croppedBuffer = await sharp(pageImage.imageBuffer)
                  .extract(crop)
                  .toBuffer();
                
                const base64 = croppedBuffer.toString('base64');
                const contextText = pageText;  
                
                const vlmResult = await describeImage(base64, contextText);
                
                if (vlmResult && vlmResult.usage) {
                  totalTokens += vlmResult.usage.totalTokens || vlmResult.usage.total_tokens || 0;
                }
                
                if (vlmResult && vlmResult.description) {
                  const descBlock = `\n\n[Visual/Scientific Content: ${vlmResult.description}]\n\n`;
                  
                  if (!region.isFullPage && region.items.length > 0) {
                    // Find the longest OCR string to use as a reliable anchor
                    const longestItem = [...region.items].sort((a, b) => b.str.length - a.str.length)[0];
                    
                    if (longestItem && longestItem.str.length > 3 && pageText.includes(longestItem.str)) {
                      // Insert the description block right before the anchor to maintain logical flow, without deleting anything
                      pageText = pageText.replace(longestItem.str, descBlock + longestItem.str);
                    } else {
                      // If no reliable anchor, append to the end of the page
                      pageText += descBlock;
                    }
                  } else {
                    // Prepend the visual context for broken equations/sparse pages
                    pageText = descBlock + pageText;
                  }
                }
              } catch (cropErr) {
                console.warn(`Error processing region on page ${pageNum}:`, cropErr.message);
              }
            }
          }
        } catch (e) {
          console.warn(`Fallback: Error in visual processing for page ${pageNum}:`, e.message);
        }
      }

      pageText = pageText.replace(/\s+/g, " ").trim();
      fullText += `Page ${pageNum}:\n${pageText}\n\n`;
    }
    
    const normalizedContent = fullText.trim().normalize('NFKC');
    return { content: normalizedContent, tokenUsage: totalTokens };
  } catch (error) {
    console.error("Critical Error parsing PDF with LiteParse:", error);
    throw error;
  }
}

module.exports = { parsePdf };
