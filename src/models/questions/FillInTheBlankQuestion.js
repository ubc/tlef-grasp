const Question = require('./Question');
const { QUESTION_TYPES } = require('../../constants/app-constants');

const FILL_IN_THE_BLANK_SCHEMA = {
    type: "object",
    additionalProperties: false,
    properties: {
        topicTitle: { type: "string" },
        question: { type: "string" },
        correctAnswer: { type: "string" },
        acceptableAnswers: { type: "array", items: { type: "string" } },
        explanation: { type: "string" },
    },
    required: ["topicTitle", "question", "correctAnswer", "acceptableAnswers", "explanation"],
};

class FillInTheBlankQuestion extends Question {
    static getJsonSchema() {
        return FILL_IN_THE_BLANK_SCHEMA;
    }

    static getPromptInstruction() {
        return `INSTRUCTIONS:
1. "topicTitle": a short neutral label (3-10 words) naming the topic. Not a question, no "?", must not reveal the answer.
2. "question": one unfinished DECLARATIVE sentence with exactly ONE blank written as _________ (nine underscores). Forbidden openings: "What is", "Which", "How", "Define", any question ending in "?".
3. "correctAnswer": the canonical text that fills the blank. Use LaTeX \\( ... \\) for math (backslashes escaped for JSON).
4. "acceptableAnswers": array including correctAnswer plus reasonable equivalents (alternate notation, synonyms).`;
    }

    static getRetrySuffix(attempt, lastError) {
        let extra = "";
        if (lastError) {
            extra = `\n\nYour previous attempt failed validation with the following error:\n"${lastError.message}"\nPlease correct this error in your new response.\n\n`;
        }
        return `${extra}For fill-in-the-blank: "question" must be one unfinished declarative sentence (not What/Which/How), with exactly one blank as _________ (nine underscores). "topicTitle" must not reveal the answer.`;
    }

    // Shape is guaranteed by the JSON schema; this only normalizes.
    static validateAndNormalize(data) {
        const qText = data.question.trim();
        const canonical = data.correctAnswer.trim();

        let acceptable = (Array.isArray(data.acceptableAnswers) ? data.acceptableAnswers : [])
            .map((a) => String(a).trim())
            .filter(Boolean);
        if (acceptable.length === 0) acceptable = [canonical];

        let topicTitle = String(data.topicTitle || "").trim().replace(/\?+$/, "");
        if (!topicTitle) {
            const beforeBlank = qText.split("_________")[0].trim();
            topicTitle = beforeBlank.split(/\s+/).filter(Boolean).slice(0, 10).join(" ") || "Fill-in-the-blank";
        }

        return {
            type: QUESTION_TYPES.FILL_IN_THE_BLANK,
            questionType: QUESTION_TYPES.FILL_IN_THE_BLANK,
            topicTitle,
            question: qText,
            correctAnswer: canonical,
            acceptableAnswers: acceptable,
            explanation: data.explanation != null ? String(data.explanation) : "",
            options: null,
        };
    }
}

module.exports = FillInTheBlankQuestion;
