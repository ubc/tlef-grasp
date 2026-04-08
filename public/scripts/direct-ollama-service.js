// Direct OpenAI API Service (Fallback)
// Uses fetch to call OpenAI directly without UBC toolkit

class DirectOpenAIService {
  constructor() {
    this.apiKey = window.OPENAI_API_KEY || process.env.OPENAI_API_KEY;
    this.model = window.OPENAI_MODEL || process.env.OPENAI_MODEL || "gpt-4.1-mini";
    this.temperature = parseFloat(window.LLM_TEMPERATURE || process.env.LLM_TEMPERATURE) || 0.7;
    this.maxTokens = parseInt(window.LLM_MAX_TOKENS || process.env.LLM_MAX_TOKENS) || 1000;
    this.isInitialized = !!this.apiKey;
    console.log("✅ Direct OpenAI Service initialized");
  }

  async generateQuestionWithRAG(prompt, ragContext = "") {
    try {
      console.log("=== DIRECT OPENAI API CALL ===");
      console.log("RAG Context length:", ragContext.length);
      console.log("Sending to OpenAI API...");

      const fullPrompt = `${ragContext}\n\n${prompt}`;

      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            {
              role: "user",
              content: fullPrompt,
            },
          ],
          temperature: this.temperature,
          max_tokens: this.maxTokens,
        }),
      });

      if (!response.ok) {
        throw new Error(
          `OpenAI API error: ${response.status} ${response.statusText}`
        );
      }

      const data = await response.json();
      const responseContent = data.choices?.[0]?.message?.content || "";
      console.log(
        "✅ OpenAI response received:",
        responseContent.substring(0, 200) + "..."
      );

      return responseContent;
    } catch (error) {
      console.error("❌ Direct OpenAI API failed:", error);
      throw error;
    }
  }

  async generateQuestionByType(questionType, objective, ragContent, bloomLevel) {
    switch (questionType) {
      case "fill-in-the-blank":
        return await this.generateFillInTheBlankQuestion(objective, ragContent, bloomLevel);
      case "multiple-choice":
      default:
        return await this.generateMultipleChoiceQuestion(objective, ragContent, bloomLevel);
    }
  }

  async generateMultipleChoiceQuestion(objective, ragContent, bloomLevel) {
    const prompt = this.createMultipleChoiceQuestionPrompt(objective, bloomLevel);
    return await this.generateQuestionWithRAG(prompt, ragContent);
  }

  async generateFillInTheBlankQuestion(objective, ragContent, bloomLevel) {
    const prompt = this.createFillInTheBlankQuestionPrompt(objective, bloomLevel);
    return await this.generateQuestionWithRAG(prompt, ragContent);
  }

  createMultipleChoiceQuestionPrompt(objective, bloomLevel) {
    return `You are an expert educational content creator. Generate a high-quality multiple-choice question based on the provided content.

OBJECTIVE: ${objective}
BLOOM'S TAXONOMY LEVEL: ${bloomLevel}

INSTRUCTIONS:
1. Create a specific, detailed question that tests understanding of the objective
2. Use actual content from the materials - don't be generic
3. Include 4 answer options
4. Make the correct answer clearly correct based on the content
5. Make incorrect answers plausible but clearly wrong
6. Focus on the specific concepts, examples, or details mentioned in the content
7. Format your response as JSON with this structure:
{
  "type": "multiple-choice",
  "question": "Your specific question here",
  "options": {
    "A": "First option text",
    "B": "Second option text",
    "C": "Third option text",
    "D": "Fourth option text"
  },
  "correctAnswer": "A",
  "explanation": "Why this answer is correct based on the content"
}

CRITICAL FORMATTING REQUIREMENTS:
- Return ONLY valid JSON. Do NOT wrap the JSON in markdown code blocks (do not use triple backticks with json or triple backticks alone).
- Do NOT include any text before or after the JSON object.
- The response must start with { and end with }.
- Return pure JSON that can be directly parsed with JSON.parse().

IMPORTANT: 
- Base your question on the specific details, examples, formulas, or concepts mentioned in the provided content. Don't create generic questions - make them specific to what's actually in the materials.
- CRITICAL: Use an object for options with keys "A", "B", "C", "D" (not an array). Place the correct answer at a random key (A, B, C, or D) and set correctAnswer to that exact key letter. For example, if the correct answer is in option "B", set correctAnswer to "B". This avoids array index confusion.
- CRITICAL: You MUST randomly choose which option (A, B, C, or D) contains the correct answer. Each letter should have an equal 25% chance of being the correct answer. Do NOT bias toward A, B, or C - ensure D is also used frequently. After placing the correct answer text in one of the four options, set correctAnswer to that exact letter. Use a random number generator or random selection - do NOT always use A, B, or C. Option D must be selected approximately 25% of the time.
- CRITICAL: Always wrap any mathematical expressions in LaTeX delimiters. You MUST use backslash-parenthesis \( ... \) for inline math (NOT plain parentheses). Examples:
  * CORRECT: \( \frac{3}{4} \) or \( x^2 + 5 = 10 \)
  * WRONG: (\frac{3}{4}) or (x^2 + 5 = 10) - these will NOT render as math
  * Use \[ ... \] for display math (block equations on their own line)
  * Do NOT use $ ... $ delimiters - only use \( ... \) for inline math and \[ ... \] for display math
  * The backslash before the parenthesis is REQUIRED - \( not just (
- CRITICAL: Do NOT include letter prefixes (A), B), C), D) or A., B., C., D. or A , B , C , D ) in the option text. The options object values should contain only the option text itself, without any letter labels, prefixes, or formatting. For example, use "The correct answer" NOT "A) The correct answer" or "A. The correct answer".`;
  }

  createFillInTheBlankQuestionPrompt(objective, bloomLevel) {
    return `You are an expert educational content creator. Generate a high-quality fill-in-the-blank item based on the provided content.

OBJECTIVE: ${objective}
BLOOM'S TAXONOMY LEVEL: ${bloomLevel}

REQUIRED "topicTitle" FIELD:
- A very short label (about 3–10 words) naming the topic or skill. Use a neutral phrase or title, NOT a question (no "?", no "What is…").
- Must NOT reveal the correct answer or paraphrase acceptableAnswers.
- Must NOT be filler such as "Fill in the blank", "Complete the sentence", or "Question".

FORMAT FOR THE "question" FIELD (mandatory):
- ONLY the item stem: one unfinished DECLARATIVE sentence (a statement with a gap), NOT an interrogative.
- FORBIDDEN: do not start with or use "What is...", "What are...", "Which...", "Who...", "How...", "Why...", "Define...", or any question mark at the end.
- The sentence MUST contain exactly ONE blank, written ONLY as nine underscores: _________
- Do not use "____", "___", "[blank]", or other placeholders—only _________
- The part that belongs in the blank is what the student should recall (term, formula, number, etc.); write the sentence so it reads naturally if the blank were filled in.

INSTRUCTIONS:
1. Create one specific fill-in-the-blank item based on the provided content.
2. Set "topicTitle" as described above, separate from the stem in "question".
3. The blank should test an important term, number, phrase, formula component, or concept from the materials.
4. Use actual details from the content - do not make the question generic.
5. Provide the correct answer and acceptableAnswers.
6. Provide a short explanation based on the content.
7. Format your response as JSON with these examples:
Example (geometry):
{
  "type": "fill-in-the-blank",
  "topicTitle": "Volume of a cone",
  "question": "The formula for the volume of a cone is _________.",
  "correctAnswer": "\\\\( \\\\frac{1}{3}\\\\pi r^2 h \\\\)",
  "acceptableAnswers": ["\\\\( \\\\frac{1}{3}\\\\pi r^2 h \\\\)", "1/3πr^2h"],
  "explanation": "Brief justification from the materials."
}

Example (non-math):
{
  "type": "fill-in-the-blank",
  "topicTitle": "European capitals",
  "question": "The capital of France is _________.",
  "correctAnswer": "Paris",
  "acceptableAnswers": ["Paris"],
  "explanation": "Brief justification from the materials."
}

CRITICAL FORMATTING REQUIREMENTS:
- Return ONLY valid JSON. No markdown fences. First character "{", last "}".
- Return pure JSON that can be parsed with JSON.parse().

IMPORTANT:
- Include "topicTitle" in every response (separate from "question").
- Exactly one _________ in "question".
- correctAnswer must be what fills the blank, not a full sentence.
- If mathematical expressions are used, also use \\( ... \\) for inline math inside the "question" string where needed (properly escaped in JSON).`;
  }

  isAvailable() {
    return this.isInitialized;
  }
}

// Export for use in other files
window.DirectOpenAIService = DirectOpenAIService;
// Keep old name for backwards compatibility
window.DirectOllamaService = DirectOpenAIService;

