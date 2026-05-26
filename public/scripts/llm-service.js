// LLM Service for Question Generation
// Interfaces with OpenAI through UBC GenAI Toolkit

// Import UBC GenAI Toolkit at the top level
import { LLMModule } from "ubc-genai-toolkit-llm";

class LLMService {
  constructor() {
    this.isInitialized = false;
    this.llmModule = null;
    this.initializeLLM();
  }

  async initializeLLM() {
    try {
      console.log("=== LLM SERVICE INITIALIZATION ===");
      console.log("UBC GenAI Toolkit imported successfully");

      // Configure for OpenAI
      const llmConfig = {
        provider: "openai",
        apiKey: window.OPENAI_API_KEY || process.env.OPENAI_API_KEY,
        model: window.OPENAI_MODEL || process.env.OPENAI_MODEL || "gpt-4.1-mini",
        temperature: parseFloat(window.LLM_TEMPERATURE || process.env.LLM_TEMPERATURE) || 0.7,
        maxTokens: parseInt(window.LLM_MAX_TOKENS || process.env.LLM_MAX_TOKENS) || 1000,
      };

      console.log("Creating LLM module with config:", {
        provider: llmConfig.provider,
        model: llmConfig.model,
        hasApiKey: !!llmConfig.apiKey,
      });
      this.llmModule = await LLMModule.create(llmConfig);
      this.isInitialized = true;
      console.log("✅ LLM Service initialized with OpenAI successfully");
    } catch (error) {
      console.error("❌ LLM initialization failed:", error);
      console.error("Error details:", error.message);
      console.error("Stack trace:", error.stack);
      this.isInitialized = false;
    }
  }

  async generateQuestionWithRAG(prompt, ragContext = "") {
    if (!this.isInitialized || !this.llmModule) {
      throw new Error("LLM service not initialized");
    }

    try {
      // Combine RAG context with prompt
      const fullPrompt = `${ragContext}\n\n${prompt}`;

      console.log("=== LLM PROMPT DEBUG ===");
      console.log("RAG Context length:", ragContext.length);
      console.log("Full prompt length:", fullPrompt.length);
      console.log("Sending to OpenAI...");

      const response = await this.llmModule.generate(fullPrompt);

      console.log("=== LLM RESPONSE DEBUG ===");
      console.log("Response length:", response.length);
      console.log("Response preview:", response.substring(0, 200) + "...");

      return response;
    } catch (error) {
      console.error("LLM generation failed:", error);
      throw error;
    }
  }

  async generateQuestionByType(questionType, objective, ragContent, bloomLevel) {
    switch (questionType) {
      case "fill-in-the-blank":
        return await this.generateFillInTheBlankQuestion(objective, ragContent, bloomLevel);
      case "calculation":
        return await this.generateCalculationQuestion(objective, ragContent, bloomLevel);
      case "open-ended":
        return await this.generateOpenEndedQuestion(objective, ragContent, bloomLevel);
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

  async generateCalculationQuestion(objective, ragContent, bloomLevel) {
    const prompt = this.createCalculationQuestionPrompt(objective, bloomLevel);
    return await this.generateQuestionWithRAG(prompt, ragContent);
  }

  async generateOpenEndedQuestion(objective, ragContent, bloomLevel) {
    const prompt = this.createOpenEndedQuestionPrompt(objective, bloomLevel);
    return await this.generateQuestionWithRAG(prompt, ragContent);
  }

  createMultipleChoiceQuestionPrompt(objective, bloomLevel) {
    return `You are an university instructor. Generate a high-quality multiple-choice question based on the provided content that effectively test students’ understanding of the course learning objective.

OBJECTIVE: ${objective}
BLOOM'S TAXONOMY LEVEL: ${bloomLevel}

Task: 
Create a multiple-choice question on based on the provided content that effectively test students' understanding of the learning objective.
Use actual content from the materials - don't be generic

Format:
Each question must have four answer choices, with only one correct answer. Label each answer choice (A, B, C, D)
the response format must be a valid JSON with the exact structure as follows:
{
  "type": "multiple-choice",
  "question": "Your specific question here",
  "options": {
    "A": "First option text", // The first option
    "B": "Second option text", // The second option
    "C": "Third option text", // The third option
    "D": "Fourth option text", // The fourth option
  },
  "correctAnswer": "A", // The letter of the correct answer
  "explanation": "Why this answer is correct based on the content" // The explanation of why the correct answer is correct
}

The distractors (incorrect answers) should be plausible but subtly flawed, to effectively test students' understanding.

IMPORTANT: 
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
- A very short label (about 3–10 words) naming the topic or skill. Neutral phrase or title only—NOT a question (no "?"), NOT "What is…".
- Must NOT reveal the answer or duplicate correctAnswer / acceptableAnswers wording.
- Must NOT be "Fill in the blank", "Complete the sentence", or similar instructions.

FORMAT FOR THE "question" FIELD (mandatory):
- ONLY the stem: one unfinished DECLARATIVE sentence (a statement with a gap), NOT an interrogative.
- FORBIDDEN: do not start with or use "What is...", "What are...", "Which...", "Who...", "How...", "Why...", "Define...", or any question mark at the end.
- The sentence MUST contain exactly ONE blank, written ONLY as nine underscores: _________
- Do not use "____", "___", "[blank]", or other placeholders—only _________
- The part that belongs in the blank is what the student should recall (term, formula, number, etc.).

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

INSTRUCTIONS:
1. Include "topicTitle" separate from the stem in "question".
2. Follow the unfinished-sentence + _________ format above.
3. Target an important term, phrase, formula, or concept from the materials.
4. correctAnswer: canonical form; use LaTeX \\( ... \\) inside the JSON string for math answers (escape backslashes for JSON).
5. acceptableAnswers: include canonical answer plus equivalents (alternate LaTeX, plain-text math, synonyms).

CRITICAL FORMATTING REQUIREMENTS:
- Return ONLY valid JSON. No markdown fences. First character "{", last "}".
- Return pure JSON that can be parsed with JSON.parse().

IMPORTANT:
- Include "topicTitle" in every response.
- Exactly one _________ in "question".
- correctAnswer must be what fills the blank, not a full sentence.
- Use \\( ... \\) for inline math inside "question" when needed (properly escaped in JSON).`;
  }

  createCalculationQuestionPrompt(objective, bloomLevel) {
    return `You are an expert educational content creator. Generate a high-quality numeric calculation question based on the provided content. The quiz system randomizes variable values each attempt and grades answers by rounding to a configured number of decimal places.

OBJECTIVE: ${objective}
BLOOM'S TAXONOMY LEVEL: ${bloomLevel}

REQUIRED "topicTitle" FIELD:
- A very short label (about 3-10 words) naming the topic or skill. Neutral phrase or title—do not embed the numeric answer or final computed result.
- Must NOT be generic filler alone (e.g. only "Calculation question"); tie the label to the content.

FORMAT FOR THE "stem" FIELD (mandatory):
- Question template for students. Use double-brace placeholders only: {{a}}, {{b}}, etc.
- Example: "If a = {{a}} and b = {{b}}, what is a multiplied by b?"
- Every variable in "calculationFormula" must appear in "stem" as {{name}} with the same "name" as in "calculationVariables".

FORMAT FOR "calculationFormula":
- One expression using variable names and + - * / ^ and parentheses. Plain ASCII only (e.g. "a * b", "(a + b) / 2", "y0 * E^(k*t)"). Do NOT use ∫, ∑, d/dx, or symbolic notation — the evaluator cannot parse them. Use LaTeX only in "stem" for display; keep "calculationFormula" as pure arithmetic.

CALCULUS-SAFE PATTERN: For calculus objectives, pre-solve the symbolic math yourself, then encode the closed-form result in "calculationFormula". The system evaluates it numerically at random variable values.
- Derivative: f(x) = {{a}}x²+{{b}}x → f'({{x}}) → formula: "2*a*x + b"
- Definite integral with simple closed form: ∫₀^{{b}} {{a}}x² dx → formula: "a * b^3 / 3"
- ODE: dy/dt = {{k}}y, y(0)={{y0}} at t={{t}} → formula: "y0 * E^(k*t)" (add calculationAnswerTolerancePercent: 1)
- IMPORTANT — if the integral has NO simple closed form (e.g. involves cos, sin, ln, or complex compositions), do NOT write the integral in the formula. Instead REFORMULATE to a simpler sub-skill: evaluate the integrand at a point, apply the power rule to a term, or test an initial condition — anything expressible as plain arithmetic.

FORMAT FOR "calculationVariables":
- Array of objects: "name", "min", "max", "decimals" (0-8), optional "integerOnly": true. Use min === max for a fixed constant.

FORMAT FOR "calculationAnswerDecimals":
- Integer 0–12. Controls how many decimal places are displayed to the student — not the grading window when tolerancePercent is set.

FORMAT FOR "calculationAnswerTolerancePercent" (OPTIONAL):
- Number 0–100. Use when the domain grades within a percentage band: e.g. 2 for chemistry, 5 for geology/engineering, 1 for ODE/integral results. Omit for exact arithmetic.

Example JSON structure (STRUCTURAL REFERENCE ONLY — do NOT copy this topic, formula, or variables; create your own based on the course content above):
{
  "type": "calculation",
  "topicTitle": "topic title here",
  "stem": "A question involving {{a}} and {{b}} goes here.",
  "calculationFormula": "a * b",
  "calculationVariables": [
    { "name": "a", "min": 1, "max": 10, "integerOnly": true },
    { "name": "b", "min": 1, "max": 5, "decimals": 1 }
  ],
  "calculationAnswerDecimals": 2,
  "explanation": "Brief justification from the content."
}

CRITICAL: The formula above ("a * b") is a placeholder. You MUST derive the formula from the actual course content. If the content is about differential equations, write a differential-equation formula. If about integration, write an integration result. Do NOT output generic formulas unrelated to the materials.

INSTRUCTIONS:
1. Create one calculation item grounded in the provided materials.
2. Include "type": "calculation", "topicTitle", "stem", "calculationFormula", "calculationVariables", "calculationAnswerDecimals", and "explanation". Add "calculationAnswerTolerancePercent" only when the subject warrants percentage-based grading.
3. Prefer 2-4 variables unless a single variable clearly suffices for the objective.
4. Ensure the formula stays finite for all sampled values in range (e.g. no division by zero).
5. Do NOT include "options", multiple-choice letters, or a static numeric correct answer field—the server grades using the formula and sampled variables.

CRITICAL FORMATTING REQUIREMENTS:
- Return ONLY valid JSON. No markdown code fences. First character "{", last "}".
- Return pure JSON that can be parsed with JSON.parse().
- Do NOT include any text before or after the JSON object.

IMPORTANT:
- Include "topicTitle" in every response (separate from "stem").
- Keep "calculationFormula" as plain math; use LaTeX \\( ... \\) only inside "stem" when needed, with backslashes escaped for JSON.
- Placeholders in "stem" must match variable names in "calculationVariables" and "calculationFormula" exactly.`;
  }

  createOpenEndedQuestionPrompt(objective, bloomLevel) {
    return `You are an expert educational content creator. Generate one open-ended question based on the provided content. The platform does NOT auto-grade text; students see a sample answer and grading criteria only after they submit.

OBJECTIVE: ${objective}
BLOOM'S TAXONOMY LEVEL: ${bloomLevel}

REQUIRED FIELDS:
- "topicTitle": short neutral label (3–10 words), not a question.
- "question" OR "stem": the prompt (paragraph OK).
- "openEndedSampleAnswer": a strong model response.
- "openEndedGradingCriteria": clear rubric or bullet-style criteria in one string.
- "explanation": brief note for instructors.

Example:
{
  "type": "open-ended",
  "topicTitle": "Conceptual comparison",
  "question": "Compare two approaches described in the materials and explain when each is preferable.",
  "openEndedSampleAnswer": "Approach A emphasizes ... whereas B focuses on ... A is preferable when ...",
  "openEndedGradingCriteria": "Full credit: contrasts both approaches with a justified use case. Partial: one approach or vague comparison.",
  "explanation": "Aligned with the reading."
}

CRITICAL: Return ONLY valid JSON. First character "{", last "}". No markdown fences. No "options" or "correctAnswer".`;
  }

  isAvailable() {
    return this.isInitialized && this.llmModule !== null;
  }
}

// Export for use in other files
window.LLMService = LLMService;
