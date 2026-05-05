const mammoth = require("mammoth");
const cheerio = require("cheerio");
const llmService = require("../services/llm");

async function describeImage(base64Image, contextText) {
  try {
    const llmModule = await llmService.getLLMInstance();
    const prompt = `You are an educational assistant. Describe the following image in detail. Use the surrounding text to provide context. Focus on data, charts, diagrams, and educational concepts. Ignore decorative elements like logos or borders. Surrounding text context: "${contextText}"\nRespond ONLY in valid JSON format with a single key "description" containing your detailed description. If the image is merely decorative and contains no educational value, set the description to "decorative".`;
    
    // Let's format it for OpenAI format, which ubc-genai-toolkit-llm usually passes through
    const message = [
      { type: "text", text: prompt },
      { type: "image_url", image_url: { url: `data:image/png;base64,${base64Image}` } }
    ];
    
    // Send the multimodal message
    const response = await llmModule.sendMessage(message);
    const rawContent = response.content || response.text || response.message || "{}";
    
    let description = "";
    try {
      const cleanContent = rawContent.replace(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/g, '$1').trim();
      const parsed = JSON.parse(cleanContent);
      description = parsed.description || "";
    } catch (e) {
      // Fallback
      description = rawContent;
    }
    
    const usage = response.usage || { totalTokens: 0 };
    
    // Check if the model says it's decorative
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

async function parseDocx(buffer) {
  let totalTokens = 0;
  
  // Extract HTML with images embedded as base64
  const result = await mammoth.convertToHtml(
    { buffer: buffer },
    {
      convertImage: mammoth.images.imgElement((image) => {
        return image.read("base64").then((imageBuffer) => {
          return {
            src: "data:" + image.contentType + ";base64," + imageBuffer
          };
        });
      })
    }
  );

  const html = result.value;
  const $ = cheerio.load(html);
  
  // We want to process each image sequentially
  const imgElements = $('img').toArray();
  for (let i = 0; i < imgElements.length; i++) {
    const img = $(imgElements[i]);
    const src = img.attr('src');
    if (src && src.startsWith('data:image')) {
      const base64Data = src.split(',')[1];
      
      // Get some surrounding text for context
      // We'll get text from the parent or preceding siblings
      const contextText = img.parent().text().substring(0, 300) || img.parent().prev().text().substring(0, 300) || "No context available";
      
      console.log(`📸 Getting description for DOCX image ${i+1}/${imgElements.length}...`);
      const result = await describeImage(base64Data, contextText);
      
      if (result && result.usage) {
        totalTokens += result.usage.totalTokens || result.usage.total_tokens || 0;
      }
      
      if (result && result.description) {
        console.log(`✅ Image described successfully: "${result.description}"`);
        // Replace image tag with a descriptive text block
        img.replaceWith(`\n\n[Image Description: ${result.description}]\n\n`);
      } else {
        img.remove();
      }
    }
  }

  // After replacing images, get the clean text
  // Replace block elements with newlines to preserve structure
  $('p, h1, h2, h3, h4, h5, h6, li, br, div').append('\n');
  let cleanText = $.text();
  
  // Clean up excessive whitespace
  cleanText = cleanText
    .replace(/\n\s*\n/g, "\n\n")
    .replace(/^\s+|\s+$/gm, "")
    .trim();

  return { content: cleanText, tokenUsage: totalTokens };
}

module.exports = { parseDocx };
