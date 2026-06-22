const Question = require('./Question');
const { QUESTION_TYPES } = require('../../constants/app-constants');

const OPEN_ENDED_SCHEMA = {
    type: "object",
    additionalProperties: false,
    properties: {
        topicTitle: { type: "string" },
        question: { type: "string" },
        openEndedSampleAnswer: { type: "string" },
        openEndedGradingCriteria: { type: "string" },
        explanation: { type: "string" },
    },
    required: ["topicTitle", "question", "openEndedSampleAnswer", "openEndedGradingCriteria", "explanation"],
};

class OpenEndedQuestion extends Question {
    static getJsonSchema() {
        return OPEN_ENDED_SCHEMA;
    }

    static getPromptInstruction() {
        return `INSTRUCTIONS:
1. "topicTitle": short neutral label (3-10 words), not a question.
2. "question": the prompt students respond to. May be paragraph-length. Do NOT use _________.
3. Match the question to the required Bloom's level:
   - Remember/Understand: recall or explain a concept ("Describe...", "Explain why...")
   - Apply/Analyze: use or break down a concept in a scenario ("Given X, apply...", "Compare...", "Examine why...")
   - Evaluate: justify or critique a choice ("Argue for or against...", "Assess whether...")
   - Create: produce or design something genuinely new ("Design a...", "Propose a...", "Construct an original...")
   Do NOT use "Create"-level verbs (design, construct, formulate) for questions that only ask students
   to describe a known procedure or recall a concept — that is Understand or Apply.
4. "openEndedSampleAnswer": a strong example response shown to students after submission (not used for auto-grading).
5. "openEndedGradingCriteria": clear, specific criteria or a short rubric students can use to self-assess.
   It must name the specific concepts or skills being assessed, not just say "complete and accurate".

SELF-CHECK BEFORE RETURNING:
- Re-read your question prompt. Does your openEndedSampleAnswer satisfy EVERY constraint you stated in the prompt? If not, fix the sample answer or the prompt — they must be consistent.
- Does your openEndedGradingCriteria assess exactly what the prompt asks for? A rubric that grades things the prompt doesn't require, or omits things the prompt does require, is wrong — fix it.
- Work through any mathematics or reasoning in your sample answer step by step. If you find an error, correct it before returning.`;
    }

    static getRetrySuffix(attempt, lastError) {
        let extra = "";
        if (lastError) {
            extra = `\n\nYour previous attempt failed validation with the following error:\n"${lastError.message}"\nPlease correct this error in your new response.\n\n`;
        }
        return `${extra}For open-ended: "openEndedGradingCriteria" must name the specific concepts assessed and fairly credit multiple valid approaches; "openEndedSampleAnswer" must satisfy the prompt's constraints.`;
    }

    // Shape is guaranteed by the JSON schema; this only normalizes.
    static validateAndNormalize(data) {
        const stemText = data.question.trim();
        let topicTitle = String(data.topicTitle || "").trim().replace(/\?+$/, "");
        if (!topicTitle) {
            topicTitle = stemText.split(/\s+/).filter(Boolean).slice(0, 10).join(" ") || "Open-ended";
        }

        return {
            type: QUESTION_TYPES.OPEN_ENDED,
            questionType: QUESTION_TYPES.OPEN_ENDED,
            topicTitle,
            question: stemText,
            stem: stemText,
            openEndedSampleAnswer: data.openEndedSampleAnswer.trim(),
            openEndedGradingCriteria: data.openEndedGradingCriteria.trim(),
            explanation: data.explanation != null ? String(data.explanation) : "",
            options: null,
        };
    }
}

module.exports = OpenEndedQuestion;
