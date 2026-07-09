const fs = require("fs").promises;
const os = require("os");
const path = require("path");
const { DocumentParsingModule } = require("ubc-genai-toolkit-document-parsing");
const { POWERPOINT_IMAGE_DESCRIPTION_PROMPT } = require("../constants/app-constants");
const { IMAGE_DESCRIPTION_SCHEMA } = require("../constants/llm-schemas");
const { generateStructured } = require("./structured-llm");
const { getVisionModel } = require("./llm-provider");

function renderPrompt(template, image) {
  const promptTemplate = template && template.trim()
    ? template
    : POWERPOINT_IMAGE_DESCRIPTION_PROMPT;
  return promptTemplate
    .replaceAll("{slideNumber}", String(image.slideNumber))
    .replaceAll("{fileName}", image.fileName || "");
}

async function describeSlideImage(image, promptTemplate) {
  const prompt = renderPrompt(promptTemplate, image);

  const { content: rawContent, usage } = await generateStructured({
    prompt,
    schema: IMAGE_DESCRIPTION_SCHEMA,
    images: [{ data: image.data.toString("base64"), mimeType: image.mimeType }],
    model: getVisionModel(),
    temperature: 0.2,
    schemaName: "image_description",
  });

  let description = "";
  try {
    const cleanContent = (rawContent || "{}")
      .replace(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/g, "$1")
      .trim();
    description = JSON.parse(cleanContent).description || "";
  } catch {
    description = rawContent || "";
  }

  if (description.toLowerCase().includes("decorative") && description.length < 150) {
    return { description: null, usage };
  }
  return { description, usage };
}

async function parsePptx(buffer, fileName = "presentation.pptx", promptTemplate = POWERPOINT_IMAGE_DESCRIPTION_PROMPT) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "grasp-pptx-"));
  const safeName = path.basename(fileName).replace(/[^\w.-]/g, "_") || "presentation.pptx";
  const tempPath = path.join(
    tempDir,
    safeName.toLowerCase().endsWith(".pptx") ? safeName : `${safeName}.pptx`
  );
  let totalTokens = 0;

  try {
    await fs.writeFile(tempPath, buffer);
    const parser = new DocumentParsingModule({
      imageConcurrency: 2,
      imageDescriber: async (image) => {
        const result = await describeSlideImage(image, promptTemplate);
        if (result?.usage) {
          totalTokens += result.usage.totalTokens || result.usage.total_tokens || 0;
        }
        return result?.description || null;
      },
    });

    const result = await parser.parse({ filePath: tempPath }, "text");
    return {
      content: result.content,
      tokenUsage: totalTokens,
      metadata: result.metadata,
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

module.exports = { parsePptx };
