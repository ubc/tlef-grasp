const Question = require('./Question');
const { QUESTION_TYPES } = require('../../constants/app-constants');

const MULTIPLE_CHOICE_OPTION = {
    type: "object",
    additionalProperties: false,
    properties: {
        text: { type: "string" },
        feedback: { type: "string" },
    },
    required: ["text", "feedback"],
};

// scratchwork is listed first so constrained decoding produces the worked
// reasoning before committing to correctAnswer (chain-of-thought).
const MULTIPLE_CHOICE_SCHEMA = {
    type: "object",
    additionalProperties: false,
    properties: {
        scratchwork: { type: "string" },
        question: { type: "string" },
        options: {
            type: "object",
            additionalProperties: false,
            properties: {
                A: MULTIPLE_CHOICE_OPTION,
                B: MULTIPLE_CHOICE_OPTION,
                C: MULTIPLE_CHOICE_OPTION,
                D: MULTIPLE_CHOICE_OPTION,
            },
            required: ["A", "B", "C", "D"],
        },
        correctAnswer: { type: "string", enum: ["A", "B", "C", "D"] },
        explanation: { type: "string" },
    },
    required: ["scratchwork", "question", "options", "correctAnswer", "explanation"],
};

class MultipleChoiceQuestion extends Question {
    static getJsonSchema() {
        return MULTIPLE_CHOICE_SCHEMA;
    }

    static getPromptInstruction() {
        return `INSTRUCTIONS:
1. Write a question stem aligned to the learning objective and Bloom's level.
   If you have already generated questions in this conversation, the new stem
   must approach the concept from a structurally different angle.
2. Generate 4 answer options (A-D). Every option must be unique — no two options
   may describe the same concept in different words.
3. Every distractor must represent a genuine misconception a student might hold,
   not an obviously wrong or trivially absurd option.
4. SELF-CHECK before setting correctAnswer: work through the problem step by step
   in the scratchwork field. Show your calculations or reasoning. Then set
   correctAnswer to the letter you confirmed is correct. Also verify no other
   option is accidentally correct.
5. For each incorrect option, write feedback that explains the specific
   misconception in that option only. Feedback must NOT hint at the correct
   answer, must NOT use comparative language ("partially right", "too large"),
   and must NOT restate the correct reasoning. Leave feedback empty for the
   correct option.`;
    }

    static getRetrySuffix(attempt, lastError) {
        let extra = "";
        if (lastError) {
            extra = `\n\nYour previous attempt failed validation with the following error:\n"${lastError.message}"\nPlease correct this error in your new response.\n\n`;
        }
        return `${extra}For multiple-choice, make sure all four options are genuinely distinct (no two describe the same concept) and that the correct option is the only correct one.`;
    }

    // Shape (options object with A-D, each {text, feedback}; correctAnswer one of
    // A-D) is guaranteed by the JSON schema. We only check semantics the schema
    // can't express (distinct options) and normalize the result.
    static validateAndNormalize(data) {
        const trimOption = (opt) => ({
            text: String(opt.text || "").trim(),
            feedback: String(opt.feedback || "").trim(),
        });

        const options = {
            A: trimOption(data.options.A),
            B: trimOption(data.options.B),
            C: trimOption(data.options.C),
            D: trimOption(data.options.D),
        };

        const optionTexts = ["A", "B", "C", "D"].map((k) => options[k].text.toLowerCase());
        if (new Set(optionTexts).size < 4) {
            throw new Error("Two or more answer options have identical or near-identical text.");
        }

        return {
            type: QUESTION_TYPES.MULTIPLE_CHOICE,
            questionType: QUESTION_TYPES.MULTIPLE_CHOICE,
            question: data.question.trim(),
            // scratchwork is intentionally omitted — used only for chain-of-thought during generation
            options,
            correctAnswer: data.correctAnswer.trim().toUpperCase(),
            explanation: data.explanation != null ? String(data.explanation) : "",
        };
    }
}

module.exports = MultipleChoiceQuestion;
