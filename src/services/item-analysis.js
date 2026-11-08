/**
 * Classical item analysis: how well each question separates stronger from
 * weaker students (discrimination index, point-biserial correlation), and how
 * consistently a quiz measures (KR-20 reliability).
 *
 * Each quiz is one "test": students are ranked by how they did on that quiz.
 * A student's total is the share of their graded answers in the quiz that
 * were correct, so a spaced quiz that served students different numbers of
 * questions still compares like with like. For an item's own statistics the
 * total leaves that item out (the corrected item–total score); with short
 * quizzes the item would otherwise correlate with itself.
 *
 * Answers awaiting grading are left out, as everywhere in analytics. Pure, so
 * it is unit-tested without a database.
 */

// Fewest students an item or quiz statistic may be computed from. Kept low
// for the pilot; below LOW_N_BELOW the figure is shown with a warning.
const MIN_STUDENTS_ITEM_ANALYSIS = 3;
const LOW_N_BELOW = 20;

// Share of students in each of the upper and lower groups.
const GROUP_SHARE = 0.27;

const round = (value, places = 3) =>
    value === null || !Number.isFinite(value) ? null : Math.round(value * 10 ** places) / 10 ** places;

const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

// Population variance (divide by N), as the point-biserial and KR-20
// formulas assume.
function variance(values) {
    const m = mean(values);
    return values.reduce((sum, value) => sum + (value - m) ** 2, 0) / values.length;
}

function pointBiserialBand(value) {
    if (value === null) return null;
    if (value < 0) return "negative";
    if (value < 0.1) return "poor";
    if (value < 0.3) return "moderate";
    return "good";
}

// Ebel's bands for the discrimination index.
function discriminationBand(value) {
    if (value === null) return null;
    if (value < 0) return "negative";
    if (value < 0.2) return "poor";
    if (value < 0.3) return "moderate";
    return "good";
}

function reliabilityBand(value) {
    if (value === null) return null;
    if (value >= 0.8) return "good";
    if (value >= 0.7) return "acceptable";
    return "low";
}

// An item is called possibly miskeyed only when clearly negative: a question
// that barely discriminates comes out slightly negative by chance alone.
const MISKEYED_BELOW = -0.1;

/**
 * A plain verdict on an item from its difficulty and discrimination.
 * Point-biserial is preferred (it uses every student); the discrimination
 * index stands in when it is missing.
 */
function itemFlag({ pValue, discrimination, pointBiserial }) {
    const primary = pointBiserial !== null ? pointBiserial : discrimination;
    if (primary === null) return null;
    if (primary < MISKEYED_BELOW) return "miskeyed";
    const band = pointBiserial !== null ? pointBiserialBand(pointBiserial) : discriminationBand(discrimination);
    if (band === "negative" || band === "poor") {
        if (pValue !== null && pValue > 0.85) return "too-easy";
        if (pValue !== null && pValue < 0.3) return "too-hard";
        return "review";
    }
    return band === "moderate" ? "fair" : "good";
}

/**
 * Graded first answers grouped as quizId -> userId -> questionId -> 0|1.
 * A question a student met twice in one quiz counts once, by its first
 * graded answer.
 */
function buildResponseMatrices(attempts) {
    const matrices = new Map();
    for (const attempt of attempts) {
        if (!attempt?.quizId || !attempt.questionId || !attempt.userId) continue;
        if (attempt.isCorrect !== true && attempt.isCorrect !== false) continue;
        const quizKey = String(attempt.quizId);
        if (!matrices.has(quizKey)) matrices.set(quizKey, new Map());
        const students = matrices.get(quizKey);
        const userKey = String(attempt.userId);
        if (!students.has(userKey)) students.set(userKey, new Map());
        const answers = students.get(userKey);
        const questionKey = String(attempt.questionId);
        if (!answers.has(questionKey)) answers.set(questionKey, attempt.isCorrect ? 1 : 0);
    }
    return matrices;
}

/**
 * Sum of item scores in the top (or bottom) `size` students ranked by rest
 * score. Students tied at the cut-off share the remaining places equally,
 * so the result never depends on the order ties happen to be listed in.
 */
function groupItemSum(rows, size, descending) {
    const sorted = [...rows].sort((a, b) => (descending ? b.rest - a.rest : a.rest - b.rest));
    let remaining = size;
    let sum = 0;
    let i = 0;
    while (remaining > 0 && i < sorted.length) {
        let j = i;
        while (j < sorted.length && sorted[j].rest === sorted[i].rest) j += 1;
        const block = sorted.slice(i, j);
        const blockSum = block.reduce((total, row) => total + row.item, 0);
        const take = Math.min(remaining, block.length);
        sum += (take / block.length) * blockSum;
        remaining -= take;
        i = j;
    }
    return sum;
}

/**
 * Discrimination index d = (Up − Lp) / n, where Up and Lp are the correct
 * answers in the upper and lower 27% and n is the size of one group.
 *
 * @param {Array<{item: 0|1, rest: number}>} rows
 */
function discriminationIndex(rows) {
    if (rows.length < 2) return null;
    const size = Math.min(Math.floor(rows.length / 2), Math.max(1, Math.round(rows.length * GROUP_SHARE)));
    return (groupItemSum(rows, size, true) - groupItemSum(rows, size, false)) / size;
}

/**
 * Point-biserial correlation r = (M1 − M0) / s · √(p·q), with s the
 * population standard deviation of the rest scores. Null when everyone got
 * the item right (or wrong), or everyone has the same rest score.
 *
 * @param {Array<{item: 0|1, rest: number}>} rows
 */
function pointBiserial(rows) {
    if (rows.length < 2) return null;
    const right = rows.filter((row) => row.item === 1).map((row) => row.rest);
    const wrong = rows.filter((row) => row.item === 0).map((row) => row.rest);
    if (right.length === 0 || wrong.length === 0) return null;
    const s = Math.sqrt(variance(rows.map((row) => row.rest)));
    if (s === 0) return null;
    const p = right.length / rows.length;
    return ((mean(right) - mean(wrong)) / s) * Math.sqrt(p * (1 - p));
}

/**
 * Discrimination statistics for every question in one quiz.
 *
 * @param {Map<string, Map<string, 0|1>>} students - userId -> questionId -> score
 * @returns {Map<string, Object>} questionId -> item statistics
 */
function analyzeQuizItems(students, minStudents = MIN_STUDENTS_ITEM_ANALYSIS) {
    const totals = new Map();
    for (const [userKey, answers] of students) {
        let correct = 0;
        for (const score of answers.values()) correct += score;
        totals.set(userKey, { correct, graded: answers.size });
    }

    const questionKeys = new Set();
    for (const answers of students.values()) for (const key of answers.keys()) questionKeys.add(key);

    const items = new Map();
    for (const questionKey of questionKeys) {
        // A student who answered only this question has no rest score.
        const rows = [];
        for (const [userKey, answers] of students) {
            if (!answers.has(questionKey)) continue;
            const { correct, graded } = totals.get(userKey);
            if (graded < 2) continue;
            const item = answers.get(questionKey);
            rows.push({ item, rest: (correct - item) / (graded - 1) });
        }

        const enough = rows.length >= minStudents;
        const pValue = rows.length ? mean(rows.map((row) => row.item)) : null;
        const discrimination = enough ? round(discriminationIndex(rows)) : null;
        const rpb = enough ? round(pointBiserial(rows)) : null;
        items.set(questionKey, {
            students: rows.length,
            enoughData: enough,
            lowN: enough && rows.length < LOW_N_BELOW,
            pValue: enough ? round(pValue) : null,
            discrimination,
            discriminationBand: discriminationBand(discrimination),
            pointBiserial: rpb,
            pointBiserialBand: pointBiserialBand(rpb),
            flag: enough ? itemFlag({ pValue, discrimination, pointBiserial: rpb }) : null,
        });
    }
    return items;
}

/**
 * KR-20 = k/(k−1) · (1 − Σpq / σ²) over the questions every student in the
 * quiz answered, with σ² the population variance of their raw totals on
 * those questions. Also the standard error of measurement, SEM = σ·√(1−KR-20),
 * as percentage points of the quiz.
 *
 * Withheld, with a reason, when the students share fewer than two graded
 * questions (common in spaced quizzes, which serve each student their own
 * pick), are too few, or all scored the same.
 *
 * @param {Map<string, Map<string, 0|1>>} students
 */
function quizReliability(students, minStudents = MIN_STUDENTS_ITEM_ANALYSIS) {
    const withheld = (reason, extra = {}) => ({
        kr20: null, sem: null, band: null, lowN: false, items: 0, students: students.size, reason, ...extra,
    });

    if (students.size < minStudents) return withheld("too-few-students");

    const vectors = [...students.values()];
    const common = [...vectors[0].keys()].filter((key) => vectors.every((answers) => answers.has(key)));
    if (common.length < 2) return withheld("different-questions", { items: common.length });

    const k = common.length;
    const totals = vectors.map((answers) => common.reduce((sum, key) => sum + answers.get(key), 0));
    const totalVariance = variance(totals);
    if (totalVariance === 0) return withheld("no-variance", { items: k });

    const sumPQ = common.reduce((sum, key) => {
        const p = mean(vectors.map((answers) => answers.get(key)));
        return sum + p * (1 - p);
    }, 0);
    const kr20 = (k / (k - 1)) * (1 - sumPQ / totalVariance);
    const sem = (Math.sqrt(totalVariance) * Math.sqrt(Math.max(0, 1 - kr20)) / k) * 100;

    return {
        kr20: round(kr20),
        sem: round(sem, 1),
        band: reliabilityBand(kr20),
        lowN: students.size < LOW_N_BELOW,
        items: k,
        students: students.size,
        reason: null,
    };
}

/**
 * Item analysis of every quiz in the attempts, plus each question's figures
 * pooled across the quizzes it appeared in (weighted by students).
 *
 * @param {Array} attempts - { userId, quizId, questionId, isCorrect } rows
 * @param {Map<string, string>} [quizNames] - quizId -> name, for breakdowns
 * @returns {{ byQuiz: Map<string, {items: Map, reliability: Object}>, byQuestion: Map<string, Object> }}
 */
function analyzeItems(attempts, quizNames = new Map(), minStudents = MIN_STUDENTS_ITEM_ANALYSIS) {
    const byQuiz = new Map();
    for (const [quizKey, students] of buildResponseMatrices(attempts)) {
        byQuiz.set(quizKey, {
            items: analyzeQuizItems(students, minStudents),
            reliability: quizReliability(students, minStudents),
        });
    }

    const perQuestion = new Map();
    for (const [quizKey, { items }] of byQuiz) {
        for (const [questionKey, stats] of items) {
            if (!perQuestion.has(questionKey)) perQuestion.set(questionKey, []);
            perQuestion.get(questionKey).push({ quizId: quizKey, quizName: quizNames.get(quizKey) || null, ...stats });
        }
    }

    const pooled = (entries, field) => {
        const rated = entries.filter((entry) => entry[field] !== null);
        const weight = rated.reduce((sum, entry) => sum + entry.students, 0);
        return weight ? rated.reduce((sum, entry) => sum + entry[field] * entry.students, 0) / weight : null;
    };

    const byQuestion = new Map();
    for (const [questionKey, entries] of perQuestion) {
        const rated = entries.filter((entry) => entry.enoughData);
        const students = rated.reduce((sum, entry) => sum + entry.students, 0);
        const pValue = round(pooled(rated, "pValue"));
        const discrimination = round(pooled(rated, "discrimination"));
        const rpb = round(pooled(rated, "pointBiserial"));
        byQuestion.set(questionKey, {
            students,
            quizzesRated: rated.length,
            enoughData: rated.length > 0,
            lowN: rated.length > 0 && students < LOW_N_BELOW,
            discrimination,
            discriminationBand: discriminationBand(discrimination),
            pointBiserial: rpb,
            pointBiserialBand: pointBiserialBand(rpb),
            flag: rated.length ? itemFlag({ pValue, discrimination, pointBiserial: rpb }) : null,
            perQuiz: entries.map(({ quizId, quizName, students: n, enoughData, discrimination: d, pointBiserial: r, flag }) => ({
                quizId, quizName, students: n, enoughData, discrimination: d, pointBiserial: r, flag,
            })),
        });
    }

    return { byQuiz, byQuestion };
}

module.exports = {
    MIN_STUDENTS_ITEM_ANALYSIS,
    LOW_N_BELOW,
    GROUP_SHARE,
    MISKEYED_BELOW,
    pointBiserialBand,
    discriminationBand,
    reliabilityBand,
    itemFlag,
    buildResponseMatrices,
    discriminationIndex,
    pointBiserial,
    analyzeQuizItems,
    quizReliability,
    analyzeItems,
};
