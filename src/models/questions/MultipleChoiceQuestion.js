const Question = require('./Question');
const { QUESTION_TYPES } = require('../../constants/app-constants');

class MultipleChoiceQuestion extends Question {
    static getPromptInstruction() {
        return `INSTRUCTIONS:
1. Write a question stem aligned to the learning objective and Bloom's level.
   If you have already generated questions in this conversation, the new stem
   must approach the concept from a structurally different angle.
2. Generate 4 answer options (A-D). Every option must be unique — no two options
   may describe the same concept in different words.
3. Every distractor must represent a genuine misconception a student might hold,
   not an obviously wrong or trivially absurd option.
4. SELF-CHECK before setting correctAnswer: reason through the question yourself
   and confirm exactly which option is correct. Then set correctAnswer to that
   letter. Also confirm that none of the other options are accidentally correct.
5. For each incorrect option, write feedback that explains the specific
   misconception in that option only. Feedback must NOT hint at the correct
   answer, must NOT use comparative language ("partially right", "too large"),
   and must NOT restate the correct reasoning.

Example structure (do NOT copy — generate content from the material above):
{
  "question": "A student applies [concept] to [scenario]. What is the result?",
  "options": {
    "A": { "text": "Incorrect option based on misconception X", "feedback": "This confuses [concept A] with [concept B]." },
    "B": { "text": "Correct option", "feedback": "" },
    "C": { "text": "Incorrect option based on misconception Y", "feedback": "This applies the right method to the wrong quantity." },
    "D": { "text": "Incorrect option based on misconception Z", "feedback": "This reverses the relationship between the two variables." }
  },
  "correctAnswer": "B"
}`;
    }

    static getSchemaHint() {
        return `Required JSON shape for multiple-choice:
{ "type": "multiple-choice", "question": "Stem?", "options": { "A": {"text":"...","feedback":"..."}, "B": {"text":"...","feedback":""}, "C": {"text":"...","feedback":"..."}, "D": {"text":"...","feedback":"..."} }, "correctAnswer": "B", "explanation": "brief" }
correctAnswer must be a single letter A–D. Set feedback to "" for the correct option.`;
    }

    static getRetrySuffix(attempt, lastError) {
        let extra = "";
        if (lastError) {
            extra = `\n\nYour previous attempt failed validation with the following error:\n"${lastError.message}"\nPlease correct this error in your new response.\n\n`;
        }
        return `${extra}For multiple-choice, required keys are exactly: "type":"multiple-choice", "question", "options" (object with four string values for keys "A","B","C","D" only), "correctAnswer" (one letter: A, B, C, or D), "explanation". Do NOT use a top-level "answer" field instead of "options" + "correctAnswer".`;
    }

    static validateAndNormalize(data) {
        const mcData = MultipleChoiceQuestion._normalizeMultipleChoiceAliases(data);

        if (!mcData.options || typeof mcData.options !== "object" || Array.isArray(mcData.options)) {
            throw new Error(
                'Missing required field: options (object with keys A, B, C, D). For multiple-choice do not use a single "answer" string instead of four options and correctAnswer A–D.'
            );
        }

        const normalizeOption = (opt) => {
            if (opt && typeof opt === "object") {
                return {
                    text: String(opt.text || opt.option || "").trim(),
                    feedback: String(opt.feedback || "").trim(),
                };
            }
            return {
                text: String(opt || "").trim(),
                feedback: "",
            };
        };

        for (const key of ["A", "B", "C", "D"]) {
            const opt = mcData.options[key];
            if (opt === undefined || opt === null) {
                throw new Error(`Missing option ${key}`);
            }
            const norm = normalizeOption(opt);
            if (!norm.text) {
                throw new Error(`Missing or empty text for option ${key}`);
            }
        }

        let letter = mcData.correctAnswer;
        if (typeof letter === "number") {
            letter = ["A", "B", "C", "D"][letter];
        }
        if (typeof letter !== "string" || !/^[ABCD]$/i.test(letter.trim())) {
            throw new Error("correctAnswer must be A, B, C, or D for multiple-choice");
        }
        letter = letter.trim().toUpperCase();

        return {
            type: QUESTION_TYPES.MULTIPLE_CHOICE,
            questionType: QUESTION_TYPES.MULTIPLE_CHOICE,
            question: mcData.question.trim(),
            options: {
                A: normalizeOption(mcData.options.A),
                B: normalizeOption(mcData.options.B),
                C: normalizeOption(mcData.options.C),
                D: normalizeOption(mcData.options.D),
            },
            correctAnswer: letter,
            explanation: mcData.explanation != null ? String(mcData.explanation) : "",
        };
    }

    static _normalizeMultipleChoiceAliases(data) {
        const d = { ...data };
        if (Array.isArray(d.choices) && d.choices.length >= 4) {
            d.options = {
                A: String(d.choices[0]),
                B: String(d.choices[1]),
                C: String(d.choices[2]),
                D: String(d.choices[3]),
            };
        }
        if (Array.isArray(d.options) && d.options.length >= 4) {
            d.options = {
                A: String(d.options[0]),
                B: String(d.options[1]),
                C: String(d.options[2]),
                D: String(d.options[3]),
            };
        }
        if (
            (d.correctAnswer == null || String(d.correctAnswer).trim() === "") &&
            typeof d.answer === "string" &&
            /^[ABCD]$/i.test(d.answer.trim())
        ) {
            d.correctAnswer = d.answer.trim().toUpperCase();
        }
        return d;
    }


}

module.exports = MultipleChoiceQuestion;
