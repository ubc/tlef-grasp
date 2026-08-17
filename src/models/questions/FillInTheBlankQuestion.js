const Question = require('./Question');
const { QUESTION_TYPES } = require('../../constants/app-constants');

// The blank marker, spelled once. The client editors expect the same nine
// underscores (QuestionCard, QuestionEditModal, AddQuestionWizard).
const BLANK = "_________";

// scratchwork is listed first so constrained decoding writes the reasoning
// before the fields it is meant to inform — a scratchwork emitted last would be
// a rationalisation of a blank already chosen.
const FILL_IN_THE_BLANK_SCHEMA = {
    type: "object",
    additionalProperties: false,
    properties: {
        scratchwork: { type: "string" },
        topicTitle: { type: "string" },
        question: { type: "string" },
        correctAnswer: { type: "string" },
        acceptableAnswers: { type: "array", items: { type: "string" } },
        explanation: { type: "string" },
    },
    required: ["scratchwork", "topicTitle", "question", "correctAnswer", "acceptableAnswers", "explanation"],
};

class FillInTheBlankQuestion extends Question {
    static getJsonSchema() {
        return FILL_IN_THE_BLANK_SCHEMA;
    }

    static getPromptInstruction() {
        return `INSTRUCTIONS:
1. "scratchwork": decide what the blank should be, then check it against rule 3
   below before writing the sentence. Reread your sentence with the blank empty
   and ask what a student who has not studied this could put there. If the
   grammar, the parallel structure, or the surrounding words leave only one
   possible word, the blank tests reading, not chemistry — choose a different
   blank and say so here.
2. "topicTitle": a short neutral label (3-10 words) naming the topic. Not a question, no "?", must not reveal the answer.
3. "question": one unfinished DECLARATIVE sentence with exactly ONE blank written as _________ (nine underscores). Forbidden openings: "What is", "Which", "How", "Define", any question ending in "?".
   The blank must not be recoverable from the sentence itself. It must be a term
   or value the student can only supply from the material — not a word the
   sentence's own grammar or parallel structure implies.
   Bad:  "the favoured side holds the weaker acid and the weaker _________"
         (the parallel with "weaker acid" gives it away)
   Bad:  "a strong acid reacts to completion, whereas a weak acid needs an _________ approach"
         (the sentence states the whole fact)
   Good: "a 0.10 M solution of HA with Ka = 1.0 x 10^-5 has [H3O+] = _________"
         (the student has to work it out)
   Good: "the variables that are not leading variables are called _________"
         (a specific term from the material)
4. "correctAnswer": the canonical text that fills the blank. Use LaTeX \\( ... \\) for math (backslashes escaped for JSON).
5. "acceptableAnswers": array including correctAnswer plus reasonable equivalents (alternate notation, synonyms).`;
    }

    static getRetrySuffix(attempt, lastError) {
        let extra = "";
        if (lastError) {
            extra = `\n\nYour previous attempt failed validation with the following error:\n"${lastError.message}"\nPlease correct this error in your new response.\n\n`;
        }
        return `${extra}For fill-in-the-blank: "question" must be one unfinished declarative sentence (not What/Which/How), with exactly one blank as _________ (nine underscores). "topicTitle" must not reveal the answer.`;
    }

    // Shape (all five fields, all strings) is guaranteed by the JSON schema. We
    // only check the one thing the schema can't express — that the stem
    // actually has a blank to fill — and normalize the result. Without this the
    // schema happily accepts a multiple-choice stem with a letter for an
    // answer, and getRetrySuffix() never gets a chance to correct it.
    static validateAndNormalize(data) {
        const qText = data.question.trim();
        const canonical = data.correctAnswer.trim();

        const blankCount = qText.split(BLANK).length - 1;
        if (blankCount !== 1) {
            throw new Error(
                `"question" must contain exactly one blank written as ${BLANK} (nine underscores); found ${blankCount}.`
            );
        }

        let acceptable = (Array.isArray(data.acceptableAnswers) ? data.acceptableAnswers : [])
            .map((a) => String(a).trim())
            .filter(Boolean);
        if (acceptable.length === 0) acceptable = [canonical];

        let topicTitle = String(data.topicTitle || "").trim().replace(/\?+$/, "");
        if (!topicTitle) {
            const beforeBlank = qText.split(BLANK)[0].trim();
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
