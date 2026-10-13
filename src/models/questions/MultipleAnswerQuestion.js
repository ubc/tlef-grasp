const Question = require('./Question');
const MultipleChoiceQuestion = require('./MultipleChoiceQuestion');
const { QUESTION_TYPES } = require('../../constants/app-constants');
const {
    MC_OPTION_KEYS,
    normalizeMcOptionCount,
    answerKeysOf,
} = require('../../utils/mc-options');

// A "select all that apply" question: the same lettered options as multiple
// choice, one or more of them correct. Students are graded all-or-nothing on
// the exact set, so every option must stand as true or false on its own.
//
// How many options are correct (one up to all but one) is checked in
// validateAndNormalize rather than in the schema: array length limits are not
// keywords every provider's constrained decoding accepts.
const buildSchema = (optionCount) => {
    const keys = MC_OPTION_KEYS.slice(0, optionCount);
    return {
        type: "object",
        additionalProperties: false,
        properties: {
            scratchwork: { type: "string" },
            question: { type: "string" },
            options: MultipleChoiceQuestion.optionsSchema(keys),
            correctAnswers: { type: "array", items: { type: "string", enum: keys } },
            explanation: { type: "string" },
        },
        required: ["scratchwork", "question", "options", "correctAnswers", "explanation"],
    };
};

const schemaCache = new Map();

class MultipleAnswerQuestion extends Question {
    // `mcOptionCount` is how many options to generate (2 to 8, default 4), the
    // same setting multiple choice uses.
    static getJsonSchema({ mcOptionCount } = {}) {
        const count = normalizeMcOptionCount(mcOptionCount);
        if (!schemaCache.has(count)) schemaCache.set(count, buildSchema(count));
        return schemaCache.get(count);
    }

    static getPromptInstruction({ mcOptionCount } = {}) {
        const count = normalizeMcOptionCount(mcOptionCount);
        const lastKey = MC_OPTION_KEYS[count - 1];
        const howMany =
            count === 2
                ? "Make exactly one option correct."
                : `Make between one and ${count - 1} options correct, and vary how many from
   question to question: do not default to two. Never make every option
   correct.`;
        return `INSTRUCTIONS:
1. Write the stem of a "select all that apply" question aligned to the learning
   objective and Bloom's level. Students are told to select all that apply, so
   the stem must not say so and must not say how many options are correct.
   Vary the construction (a scenario or vignette, data to interpret, a set of
   claims to judge, etc.). If you have already generated questions in this
   conversation, the new stem must approach the concept from a structurally
   different angle.
2. Generate ${count} answer options (A-${lastKey}), and no others. Every option
   must be unique, and every option must be true or false of the stem on its
   own: no option may refer to another ("both A and B", "all of the above",
   "none of the above").
3. ${howMany}
4. Every incorrect option must represent a genuine misconception a student might
   hold, not an obviously wrong or trivially absurd option.
5. SELF-CHECK before setting correctAnswers: in the scratchwork field, judge
   every option on its own, true or false, and show your reasoning or
   calculations. Then verify each verdict using a method DIFFERENT from how you
   constructed the option — re-derive it from first principles or a worked
   example rather than re-stating the rule you built it from. Only after this
   independent check, set correctAnswers to every letter you confirmed is
   correct, and only those.
6. For each incorrect option, write feedback that explains the specific
   misconception in that option only. Feedback must NOT hint at which options
   are correct, must NOT use comparative language ("partially right", "too
   large"), and must NOT restate the correct reasoning. Leave feedback empty for
   the correct options.`;
    }

    static getRetrySuffix(attempt, lastError) {
        let extra = "";
        if (lastError) {
            extra = `\n\nYour previous attempt failed validation with the following error:\n"${lastError.message}"\nPlease correct this error in your new response.\n\n`;
        }
        return `${extra}For multiple-answer, make sure every option is genuinely distinct (no two describe the same concept), that you give exactly the number of options asked for, that correctAnswers lists every correct option and only those, and that at least one option is incorrect.`;
    }

    // Shape (options keyed by letter; correctAnswers a list of those letters)
    // is guaranteed by the JSON schema. We check what it can't express: the
    // options' lettering and distinctness, one correct option up to all but
    // one, and feedback on every incorrect option. The stored question keeps
    // the correct letters in correctAnswer, as every multiple-answer question
    // does.
    static validateAndNormalize(data) {
        const { keys, options } = MultipleChoiceQuestion.normalizeOptions(
            data.options,
            "multiple-answer"
        );

        const listed = Array.isArray(data.correctAnswers) ? data.correctAnswers : [];
        const unknown = listed.filter(
            (letter) => !keys.includes(String(letter ?? "").trim().toUpperCase())
        );
        if (unknown.length > 0) {
            throw new Error(`correctAnswers must list only ${keys.join(", ")} (got ${unknown.join(", ")}).`);
        }
        const correctAnswer = answerKeysOf(listed);
        if (correctAnswer.length === 0) {
            throw new Error("correctAnswers must list at least one correct option.");
        }
        if (correctAnswer.length === keys.length) {
            throw new Error("Every option is marked correct; at least one option must be incorrect.");
        }

        const missingFeedback = keys.filter(
            (k) => !correctAnswer.includes(k) && !options[k].feedback
        );
        if (missingFeedback.length > 0) {
            throw new Error(
                `Incorrect option(s) ${missingFeedback.join(", ")} are missing feedback explaining the misconception.`
            );
        }

        return {
            type: QUESTION_TYPES.MULTIPLE_ANSWER,
            questionType: QUESTION_TYPES.MULTIPLE_ANSWER,
            question: data.question.trim(),
            // scratchwork is intentionally omitted — used only for chain-of-thought during generation
            options,
            correctAnswer,
            explanation: data.explanation != null ? String(data.explanation) : "",
        };
    }
}

module.exports = MultipleAnswerQuestion;
