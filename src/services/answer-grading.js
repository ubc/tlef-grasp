// LLM answer grading (issue #45).
//
// Two judges, both schema-constrained via generateStructured so the output
// shape is guaranteed regardless of provider:
//   - Open-ended: (question, student answer, rubric, sample) →
//     { pass, overallFeedback, criteria: [{ criterion, met, comment }] }.
//     The verdict is written to the attempt as the grade; instructors can
//     override it in the quiz-scores review modal.
//   - Fill-in-the-blank fallback: runs only after exact matching fails, and
//     can only rescue an answer to correct — it never downgrades a match.
//
// Prompts are course-scoped and instructor-editable (Settings → Course
// Prompts); callers must pass courseId so the course's override is used.

const settingsService = require("./settings");
const { generateStructured } = require("../utils/structured-llm");
const {
    OPEN_ENDED_GRADING_SCHEMA,
    FILL_IN_THE_BLANK_GRADING_SCHEMA,
} = require("../constants/llm-schemas");
const { DEFAULT_PROMPTS } = require("../constants/app-constants");

// Placeholder filling via split/join instead of String.replace: student
// answers routinely contain `$` and other replacement-pattern characters
// that String.replace would mangle, and each placeholder may appear more
// than once in an instructor-edited prompt.
const fillTemplate = (template, vars) => {
    let out = String(template);
    for (const [key, value] of Object.entries(vars)) {
        out = out.split(`{${key}}`).join(value == null ? "" : String(value));
    }
    return out;
};

const getPromptForCourse = async (courseId, promptKey) => {
    try {
        if (courseId) {
            const settings = await settingsService.getSettings(String(courseId));
            const prompt = settings?.prompts?.[promptKey];
            if (prompt && String(prompt).trim()) return prompt;
        }
    } catch (error) {
        console.error(`[Answer Grading] Failed to load ${promptKey} prompt for course ${courseId}, using default:`, error);
    }
    return DEFAULT_PROMPTS[promptKey];
};

/**
 * Grade an open-ended answer against the instructor's rubric and sample answer.
 *
 * @param {object} params
 * @param {string} params.courseId        Course whose prompt override applies.
 * @param {string} params.question        The question stem shown to the student.
 * @param {string} params.studentAnswer   The student's response.
 * @param {string} params.sampleAnswer    Instructor's sample strong answer.
 * @param {string} params.gradingCriteria Instructor's rubric/criteria text.
 * @returns {Promise<{ pass: boolean, overallFeedback: string, criteria: Array<{criterion: string, met: boolean, comment: string}> }>}
 * @throws when the LLM call fails or returns unparseable output — callers
 *         degrade to the pre-LLM behavior (manual grading).
 */
const gradeOpenEndedAnswer = async ({ courseId, question, studentAnswer, sampleAnswer, gradingCriteria }) => {
    const template = await getPromptForCourse(courseId, "openEndedGrading");
    const prompt = fillTemplate(template, {
        question,
        studentAnswer,
        sampleAnswer,
        gradingCriteria: gradingCriteria || "No explicit rubric provided — grade against the key concepts required by the question and demonstrated in the sample answer.",
    });

    const { content } = await generateStructured({
        prompt,
        schema: OPEN_ENDED_GRADING_SCHEMA,
        temperature: 0.1,
        schemaName: "open_ended_grading",
    });

    const result = JSON.parse(content);
    return {
        pass: !!result.pass,
        overallFeedback: String(result.overallFeedback || "").trim(),
        criteria: (Array.isArray(result.criteria) ? result.criteria : []).map((c) => ({
            criterion: String(c.criterion || "").trim(),
            met: !!c.met,
            comment: String(c.comment || "").trim(),
        })),
    };
};

/**
 * Fallback judge for fill-in-the-blank answers that failed exact matching.
 * Decides whether the answer is equivalent to an accepted answer (alternate
 * notation, synonym, longer phrasing) and always returns student-facing
 * feedback.
 *
 * @param {object} params
 * @param {string}   params.courseId
 * @param {string}   params.question           Stem containing the blank.
 * @param {string}   params.studentAnswer
 * @param {string}   params.correctAnswer      Canonical answer.
 * @param {string[]} [params.acceptableAnswers] Instructor-suggested alternatives.
 * @returns {Promise<{ correct: boolean, feedback: string }>}
 * @throws when the LLM call fails — callers keep the exact-match verdict.
 */
const gradeFillInTheBlankAnswer = async ({ courseId, question, studentAnswer, correctAnswer, acceptableAnswers }) => {
    const template = await getPromptForCourse(courseId, "fillInTheBlankGrading");
    const alternatives = (Array.isArray(acceptableAnswers) ? acceptableAnswers : [])
        .map((a) => String(a).trim())
        .filter((a) => a && a !== String(correctAnswer).trim());
    const prompt = fillTemplate(template, {
        question,
        studentAnswer,
        correctAnswer,
        acceptableAnswers: alternatives.length > 0 ? alternatives.join("; ") : "(none)",
    });

    const { content } = await generateStructured({
        prompt,
        schema: FILL_IN_THE_BLANK_GRADING_SCHEMA,
        temperature: 0.1,
        schemaName: "fill_in_the_blank_grading",
    });

    const result = JSON.parse(content);
    return {
        correct: !!result.correct,
        feedback: String(result.feedback || "").trim(),
    };
};

module.exports = {
    gradeOpenEndedAnswer,
    gradeFillInTheBlankAnswer,
};
