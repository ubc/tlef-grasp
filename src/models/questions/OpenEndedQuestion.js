const Question = require('./Question');
const { QUESTION_TYPES } = require('../../constants/app-constants');

class OpenEndedQuestion extends Question {
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
6. Do NOT include "options", "correctAnswer", or calculation fields.

SELF-CHECK BEFORE RETURNING:
- Re-read your question prompt. Does your openEndedSampleAnswer satisfy EVERY constraint you stated in the prompt? If not, fix the sample answer or the prompt — they must be consistent.
- Does your openEndedGradingCriteria assess exactly what the prompt asks for? A rubric that grades things the prompt doesn't require, or omits things the prompt does require, is wrong — fix it.
- Work through any mathematics or reasoning in your sample answer step by step. If you find an error, correct it before returning.

Example:
{
  "topicTitle": "Design trade-offs",
  "question": "Explain two trade-offs between caching and freshness in a web application.",
  "openEndedSampleAnswer": "Caching improves latency and reduces load, but stale data can confuse users unless TTLs or invalidation are chosen carefully.",
  "openEndedGradingCriteria": "Full credit: two distinct trade-offs with reasoning. Partial: one trade-off or vague reasoning. No credit: off-topic.",
  "explanation": "Brief justification from the content."
}`;
    }

    static getSchemaHint() {
        return `Required JSON shape for open-ended:
{ "type": "open-ended", "topicTitle": "short label", "question": "The prompt for students.", "openEndedSampleAnswer": "A strong example answer shown after submission.", "openEndedGradingCriteria": "Rubric or criteria for self-assessment.", "explanation": "brief" }
Both "openEndedSampleAnswer" AND "openEndedGradingCriteria" are required. No "options" or "correctAnswer" field.`;
    }

    static getRetrySuffix(attempt, lastError) {
        let extra = "";
        if (lastError) {
            extra = `\n\nYour previous attempt failed validation with the following error:\n"${lastError.message}"\nPlease correct this error in your new response.\n\n`;
        }
        return `${extra}For open-ended: "type":"open-ended", "topicTitle", "question" (or "stem") as the prompt, "openEndedSampleAnswer" (model answer shown after submit), "openEndedGradingCriteria" (rubric / what earns full credit), "explanation". No "options" or auto-graded correctAnswer.`;
    }

    static validateAndNormalize(data) {
        const merged = { ...data };
        const stemText = String(merged.stem || merged.question || "").trim();
        if (!stemText) {
            throw new Error(
                "Missing required field: stem or question for open-ended"
            );
        }
        const sample = String(
            merged.openEndedSampleAnswer || merged.sampleAnswer || ""
        ).trim();
        if (!sample) {
            throw new Error("Missing required field: openEndedSampleAnswer");
        }
        const criteria = String(
            merged.openEndedGradingCriteria || merged.gradingCriteria || ""
        ).trim();
        if (!criteria) {
            throw new Error("Missing required field: openEndedGradingCriteria");
        }
        let topicTitle = (merged.topicTitle || merged.topic || merged.shortTitle || "")
            .trim()
            .replace(/\?+$/, "");
        if (!topicTitle) {
            const words = stemText.split(/\s+/).filter(Boolean);
            topicTitle = words.slice(0, 10).join(" ") || "Open-ended";
        }
        return {
            type: QUESTION_TYPES.OPEN_ENDED,
            questionType: QUESTION_TYPES.OPEN_ENDED,
            topicTitle,
            question: stemText,
            stem: stemText,
            openEndedSampleAnswer: sample,
            openEndedGradingCriteria: criteria,
            explanation: merged.explanation != null ? String(merged.explanation) : "",
            options: null,
        };
    }
}

module.exports = OpenEndedQuestion;
