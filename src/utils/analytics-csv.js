/**
 * CSV exports of the Analytics views.
 *
 * Each builder takes exactly the data object the matching analytics endpoint
 * returns, so a file can never show more than the page: figures the page
 * withholds (too few responses or students) are written as NOT_ENOUGH_DATA,
 * and no row carries a student. Pure, so it is unit-tested directly.
 */

const NOT_ENOUGH_DATA = "not enough data";

// Text a spreadsheet would run as a formula (CSV injection) is prefixed with
// an apostrophe, which spreadsheets display as plain text.
const FORMULA_START = /^[=+\-@\t\r]/;

function cell(value) {
    if (value === null || value === undefined) return "";
    if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
    let text = String(value);
    if (FORMULA_START.test(text)) text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * A CSV document: a header row and data rows, CRLF line endings, and a UTF-8
 * byte-order mark so Excel reads symbols like "→" and "–" correctly.
 */
function toCsv(header, rows) {
    return `﻿${[header, ...rows].map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`;
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };

// Question and option text is stored as HTML; a spreadsheet wants plain text.
function htmlToText(html) {
    return String(html || "")
        .replace(/<(br|\/p|\/div|\/li)\b[^>]*>/gi, " ")
        .replace(/<[^>]*>/g, "")
        .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, name) => ENTITIES[name])
        .replace(/\s+/g, " ")
        .trim();
}

// A share (0–1) as a percentage with one decimal, or the withheld marker.
const percentOrWithheld = (share, shown) =>
    shown && share !== null && share !== undefined ? Math.round(share * 1000) / 10 : NOT_ENOUGH_DATA;

const valueOrWithheld = (value, shown) => (shown ? value : NOT_ENOUGH_DATA);

const DIFFICULTY_LABELS = { easy: "Easy", moderate: "Moderate", hard: "Hard", insufficient: NOT_ENOUGH_DATA };

function questionsCsv(data) {
    const optionKeys = [...new Set(
        data.questions.flatMap((question) => (question.options || []).map((option) => option.key))
    )].sort();

    const header = [
        "Question", "Type", "Bloom level", "Graded responses", "Students", "Awaiting grading",
        "Correct (%)", "Difficulty", "Correct responses", "Missed",
        ...(optionKeys.length ? ["Correct option", ...optionKeys.map((key) => `Chose ${key}`)] : []),
    ];

    const rows = data.questions.map((question) => {
        const shown = question.enoughData;
        const options = new Map((question.options || []).map((option) => [option.key, option]));
        const optionCells = optionKeys.length
            ? [
                question.options
                    ? question.options.filter((option) => option.isCorrect).map((option) => option.key).join(" ")
                    : "",
                ...optionKeys.map((key) => {
                    if (!question.options) return question.questionType === "multiple-choice" ? NOT_ENOUGH_DATA : "";
                    return options.has(key) ? options.get(key).count : "";
                }),
            ]
            : [];
        return [
            htmlToText(question.text),
            question.questionType,
            question.bloom || "",
            question.responses,
            question.students,
            question.pending,
            percentOrWithheld(question.pValue, shown),
            DIFFICULTY_LABELS[question.difficulty] || question.difficulty,
            valueOrWithheld(question.correct, shown),
            valueOrWithheld(question.incorrect, shown),
            ...optionCells,
        ];
    });

    return toCsv(header, rows);
}

function quizzesCsv(data) {
    const binLabels = data.quizzes.find((quiz) => quiz.distribution)?.distribution.map((bin) => bin.label)
        || ["0–9", "10–19", "20–29", "30–39", "40–49", "50–59", "60–69", "70–79", "80–89", "90–100"];

    const header = [
        "Quiz", "Assigned", "Submitted", "Completion (%)", "Average score (%)", "Median score (%)",
        "Average time (minutes)", ...binLabels.map((label) => `Scored ${label}%`),
        "Submissions awaiting grading",
    ];

    const rows = data.quizzes.map((quiz) => {
        const shown = quiz.enoughData;
        const round1 = (value) => (value === null ? "" : Math.round(value * 10) / 10);
        return [
            quiz.name,
            quiz.assigned,
            quiz.submitted,
            quiz.completionRate === null ? "" : Math.round(quiz.completionRate * 1000) / 10,
            valueOrWithheld(round1(quiz.meanScore), shown),
            valueOrWithheld(round1(quiz.medianScore), shown),
            valueOrWithheld(quiz.averageTimeSpent ? round1(quiz.averageTimeSpent / 60000) : "", shown),
            ...binLabels.map((_, i) => valueOrWithheld(quiz.distribution?.[i]?.count, shown)),
            quiz.pendingSubmissions,
        ];
    });

    return toCsv(header, rows);
}

function objectivesCsv(data) {
    const header = [
        "Objective", "Level", "Parent objective", "Correct (%)", "Graded responses", "Students",
        "Awaiting grading", "Students judged for mastery", "Mastered", "Mastery rate (%)",
        "Students tracked for remediation", "Flagged for remediation", "Remediation rate (%)",
    ];

    const objectiveRow = (row, parentName) => [
        row.name,
        parentName ? "Sub-objective" : "Objective",
        parentName || "",
        percentOrWithheld(row.pValue, row.enoughData),
        row.responses,
        row.studentsAssessed,
        row.pending,
        row.masteryJudged,
        valueOrWithheld(row.mastered, row.enoughMasteryData),
        percentOrWithheld(row.masteryRate, row.enoughMasteryData),
        row.remediationTracked,
        valueOrWithheld(row.needsRemediation, row.enoughRemediationData),
        percentOrWithheld(row.remediationRate, row.enoughRemediationData),
    ];

    const rows = data.objectives.flatMap((row) => [
        objectiveRow(row, null),
        ...row.granular.map((child) => objectiveRow(child, row.name)),
    ]);

    return toCsv(header, rows);
}

const CSV_BUILDERS = {
    questions: questionsCsv,
    quizzes: quizzesCsv,
    objectives: objectivesCsv,
};

module.exports = {
    NOT_ENOUGH_DATA,
    CSV_BUILDERS,
    cell,
    toCsv,
    htmlToText,
    questionsCsv,
    quizzesCsv,
    objectivesCsv,
};
