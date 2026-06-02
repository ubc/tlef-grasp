const Question = require('./Question');
const { QUESTION_TYPES } = require('../../constants/app-constants');

class FillInTheBlankQuestion extends Question {
    static getPromptInstruction() {
        return `INSTRUCTIONS:
1. "topicTitle": a short neutral label (3-10 words) naming the topic. Not a question, no "?", must not reveal the answer.
2. "question": one unfinished DECLARATIVE sentence with exactly ONE blank written as _________ (nine underscores). Forbidden openings: "What is", "Which", "How", "Define", any question ending in "?".
3. "correctAnswer": the canonical text that fills the blank. Use LaTeX \\( ... \\) for math (backslashes escaped for JSON).
4. "acceptableAnswers": array including correctAnswer plus reasonable equivalents (alternate notation, synonyms).
5. Do NOT include an "options" object.

Example:
{
  "topicTitle": "Volume of a cone",
  "question": "The formula for the volume of a cone is _________.",
  "correctAnswer": "\\\\( \\\\frac{1}{3}\\\\pi r^2 h \\\\)",
  "acceptableAnswers": ["\\\\( \\\\frac{1}{3}\\\\pi r^2 h \\\\)", "1/3πr^2h"],
  "explanation": "Brief justification from the content."
}`;
    }

    static getSchemaHint() {
        return `Required JSON shape for fill-in-the-blank:
{ "type": "fill-in-the-blank", "topicTitle": "short label", "question": "Declarative sentence with exactly _________ for the blank.", "correctAnswer": "answer", "acceptableAnswers": ["answer","synonym"], "explanation": "brief" }
Rules: question must be a declarative sentence (not a question), exactly one blank as _________ (nine underscores). No "options" field.`;
    }

    static getRetrySuffix(attempt, lastError) {
        let extra = "";
        if (lastError) {
            extra = `\n\nYour previous attempt failed validation with the following error:\n"${lastError.message}"\nPlease correct this error in your new response.\n\n`;
        }
        return `${extra}For fill-in-the-blank: include "topicTitle" (short topic label, not a question, must not reveal the answer or say "fill in the blank"). "question" must be one unfinished declarative sentence (not What/Which/How), with exactly one blank as _________ (nine underscores). Include "correctAnswer", "acceptableAnswers", "explanation". No "options".`;
    }

    static validateAndNormalize(data) {
        if (!data.question || typeof data.question !== "string" || !data.question.trim()) {
            throw new Error("Missing required field: question");
        }

        const merged = { ...data };
        if (
            (merged.correctAnswer == null || String(merged.correctAnswer).trim() === "") &&
            typeof merged.answer === "string" &&
            merged.answer.trim()
        ) {
            merged.correctAnswer = merged.answer.trim();
        }
        const ca = merged.correctAnswer;
        if (ca === undefined || ca === null || String(ca).trim() === "") {
            throw new Error(
                "Missing required field: correctAnswer (expected short answer text for fill-in-the-blank)"
            );
        }
        const canonical = typeof ca === "string" ? ca.trim() : String(ca);
        let acceptable = merged.acceptableAnswers;
        if (!Array.isArray(acceptable) || acceptable.length === 0) {
            acceptable = [canonical];
        } else {
            acceptable = acceptable
                .map((a) => (typeof a === "string" ? a.trim() : String(a)))
                .filter(Boolean);
            if (acceptable.length === 0) {
                acceptable = [canonical];
            }
        }
        const qText = merged.question.trim();
        let topicTitle = (merged.topicTitle || merged.topic || merged.shortTitle || "")
            .trim()
            .replace(/\?+$/, "");
        if (!topicTitle) {
            const beforeBlank = qText.split("_________")[0].trim();
            const words = beforeBlank.split(/\s+/).filter(Boolean);
            topicTitle = words.slice(0, 10).join(" ") || "Fill-in-the-blank";
        }
        return {
            type: QUESTION_TYPES.FILL_IN_THE_BLANK,
            questionType: QUESTION_TYPES.FILL_IN_THE_BLANK,
            topicTitle,
            question: qText,
            correctAnswer: canonical,
            acceptableAnswers: acceptable,
            explanation: merged.explanation != null ? String(merged.explanation) : "",
            options: null,
        };
    }
}

module.exports = FillInTheBlankQuestion;
