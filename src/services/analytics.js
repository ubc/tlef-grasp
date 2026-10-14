/**
 * Course analytics: class-level summaries of how students performed.
 *
 * Analytics answer "how is the class doing", never "how is this student
 * doing" — per-student views stay on Quiz Scores. So everything here is an
 * aggregate: no response carries a student id, name, or individual answer,
 * and a figure is withheld unless it comes from at least MIN_RESPONSES graded
 * answers given by at least MIN_STUDENTS different students. A tiny group is
 * both statistically meaningless and close to identifying the individuals in
 * it. Both limits matter: one student answering a question in several quizzes
 * gives many responses but still describes one person.
 *
 * Only graded answers count. An answer still awaiting grading (open-ended
 * with isCorrect === null) is reported as pending and excluded from every
 * percentage, so it never reads as wrong.
 */

const { ObjectId } = require("mongodb");
const databaseService = require("./database");
const { getCourseUsers } = require("./user-course");
const { getSectionsForViewer } = require("./course-section");
const { resolveCourseRole } = require("../utils/course-access");
const { isFaculty } = require("../utils/auth");
const { optionKeysOf, optionAt, optionTextOf, correctAnswerKey } = require("../utils/mc-options");

// Fewest graded responses, and fewest different students giving them, that a
// figure may be computed from. MIN_STUDENTS is set to 3 for now and is meant
// to rise to 5.
const MIN_RESPONSES = 5;
const MIN_STUDENTS = 3;

const DEFAULT_THRESHOLDS = { minResponses: MIN_RESPONSES, minStudents: MIN_STUDENTS };

const meetsThresholds = (responses, students, { minResponses, minStudents }) =>
    responses >= minResponses && students >= minStudents;

// Difficulty index (share of graded responses that were correct) bands.
const EASY_ABOVE = 0.85;
const HARD_BELOW = 0.3;

const MOST_MISSED_LIMIT = 10;

const toId = (id) => (ObjectId.isValid(id) ? new ObjectId(id) : id);

function difficultyBand(pValue) {
    if (pValue === null) return "insufficient";
    if (pValue > EASY_ABOVE) return "easy";
    if (pValue < HARD_BELOW) return "hard";
    return "moderate";
}

/**
 * Per-question statistics from raw attempt rows. Pure, so it is unit-tested
 * without a database.
 *
 * @param {Array} attempts - { userId, questionId, isCorrect, selectedAnswer } rows
 * @param {Array} questions - grasp_question docs for every question in scope
 *   (questions with no responses still appear, with zero counts)
 * @param {Object} [thresholds] - { minResponses, minStudents }
 * @returns {{ questions: Array, mostMissed: Array, summary: Object }}
 */
function summarizeQuestionStats(attempts, questions, thresholds = DEFAULT_THRESHOLDS) {
    const newTally = () => ({ correct: 0, incorrect: 0, pending: 0, selections: new Map(), students: new Set() });
    const tallies = new Map();
    const tallyFor = (questionId) => {
        const key = String(questionId);
        if (!tallies.has(key)) tallies.set(key, newTally());
        return tallies.get(key);
    };

    for (const attempt of attempts) {
        if (!attempt?.questionId) continue;
        const tally = tallyFor(attempt.questionId);
        if (attempt.isCorrect === true) tally.correct += 1;
        else if (attempt.isCorrect === false) tally.incorrect += 1;
        else {
            tally.pending += 1;
            continue;
        }
        tally.students.add(String(attempt.userId));
        if (typeof attempt.selectedAnswer === "string" && attempt.selectedAnswer) {
            const key = attempt.selectedAnswer.trim().toUpperCase();
            tally.selections.set(key, (tally.selections.get(key) || 0) + 1);
        }
    }

    const rows = questions.map((question) => {
        const tally = tallies.get(String(question._id)) || newTally();
        const responses = tally.correct + tally.incorrect;
        const enoughData = meetsThresholds(responses, tally.students.size, thresholds);
        const pValue = enoughData ? tally.correct / responses : null;
        const questionType = question.questionType || question.type || "multiple-choice";

        // Which options students chose. Only for multiple choice, and only
        // with enough responses: per-option counts on a small group would
        // show what a handful of identifiable students answered.
        let options = null;
        if (questionType === "multiple-choice" && enoughData) {
            const correctKey = correctAnswerKey(question.correctAnswer);
            options = optionKeysOf(question.options).map((key) => ({
                key,
                text: optionTextOf(optionAt(question.options, key)),
                count: tally.selections.get(key) || 0,
                isCorrect: key === correctKey,
            }));
        }

        return {
            questionId: String(question._id),
            text: question.title || question.stem || "",
            questionType,
            bloom: question.bloom || null,
            granularObjectiveId: question.granularObjectiveId ? String(question.granularObjectiveId) : null,
            responses,
            students: tally.students.size,
            pending: tally.pending,
            enoughData,
            // Counts are withheld with the percentage: "1 of 2 missed it"
            // says as much as "50%".
            correct: enoughData ? tally.correct : null,
            incorrect: enoughData ? tally.incorrect : null,
            pValue,
            difficulty: difficultyBand(pValue),
            options,
        };
    });

    const rated = rows.filter((row) => row.enoughData);
    const mostMissed = [...rated]
        .filter((row) => row.incorrect > 0)
        .sort((a, b) => b.incorrect - a.incorrect || a.pValue - b.pValue)
        .slice(0, MOST_MISSED_LIMIT)
        .map((row) => row.questionId);

    const summary = {
        totalQuestions: rows.length,
        ratedQuestions: rated.length,
        gradedResponses: rows.reduce((sum, row) => sum + row.responses, 0),
        pendingResponses: rows.reduce((sum, row) => sum + row.pending, 0),
        averagePValue: rated.length
            ? rated.reduce((sum, row) => sum + row.pValue, 0) / rated.length
            : null,
        bands: {
            easy: rated.filter((row) => row.difficulty === "easy").length,
            moderate: rated.filter((row) => row.difficulty === "moderate").length,
            hard: rated.filter((row) => row.difficulty === "hard").length,
            insufficient: rows.length - rated.length,
        },
    };

    return { questions: rows, mostMissed, summary };
}

/**
 * Whether a section is one the viewer may see analytics for.
 */
async function canViewSection(courseId, user, sectionId) {
    const { sections } = await getSectionsForViewer(courseId, user);
    return sections.some((section) => section.sectionId === sectionId);
}

/**
 * The students an analytics view aggregates over: members whose role in this
 * course is student (so instructors' and TAs' own test runs never skew the
 * numbers), limited to the viewer's visible sections the same way Quiz Scores
 * is, and to one section when sectionId is given.
 *
 * @returns {Promise<Array<{userId, sections: string[]}>>} userId as stored
 */
async function getCohortStudents(courseId, user, { sectionId = null } = {}) {
    const courseUsers = await getCourseUsers(courseId);
    const { seeAll, sections } = await getSectionsForViewer(courseId, user);
    const visible = new Set(sections.map((section) => section.sectionId));

    const students = [];
    for (const membership of courseUsers) {
        const userDoc = membership.user || membership;
        if (!membership.userId || !userDoc?.affiliation) continue;
        const role = resolveCourseRole(userDoc, membership, await isFaculty(userDoc));
        if (role !== "student") continue;

        const memberSections = Array.isArray(membership.sections) ? membership.sections : [];
        if (sectionId && !memberSections.includes(sectionId)) continue;
        if (!seeAll && !memberSections.some((id) => visible.has(id))) continue;
        students.push({ userId: membership.userId, sections: memberSections });
    }
    return students;
}

/**
 * getCohortStudents, as bare userIds.
 */
async function getCohortStudentIds(courseId, user, options) {
    return (await getCohortStudents(courseId, user, options)).map((student) => student.userId);
}

/**
 * Question analytics for a course, or for one quiz in it.
 *
 * Statistics come from the answers recorded in the quiz(zes), not from the
 * quizzes' question lists: a spaced quiz serves each student their own pick,
 * including questions from earlier quizzes. Questions linked to the quiz that
 * nobody has answered yet are still listed, with no data. Across the whole
 * course a student may have answered the same question in several quizzes,
 * so counts are of graded responses, not of students.
 *
 * @param {string} courseId
 * @param {Object} options
 * @param {string|null} options.quizId - limit to one quiz of the course
 * @param {Array} options.studentIds - from getCohortStudentIds
 */
async function getQuestionAnalytics(courseId, { quizId = null, studentIds }) {
    const db = await databaseService.connect();

    let quizIds;
    if (quizId) {
        quizIds = [toId(quizId)];
    } else {
        const quizzes = await db.collection("grasp_quiz")
            .find({ courseId: toId(courseId) }, { projection: { _id: 1 } })
            .toArray();
        quizIds = quizzes.map((quiz) => quiz._id);
    }

    if (quizIds.length === 0 || studentIds.length === 0) {
        return { ...summarizeQuestionStats([], []), ...DEFAULT_THRESHOLDS };
    }

    const [attempts, links] = await Promise.all([
        db.collection("grasp_student_attempt")
            .find(
                {
                    quizId: { $in: quizIds },
                    userId: { $in: studentIds.map(toId) },
                    isFirstAttempt: { $ne: false },
                },
                { projection: { userId: 1, questionId: 1, isCorrect: 1, selectedAnswer: 1 } }
            )
            .toArray(),
        db.collection("grasp_quiz_question")
            .find({ quizId: { $in: quizIds } }, { projection: { questionId: 1 } })
            .toArray(),
    ]);

    const questionIds = new Map();
    for (const row of [...links, ...attempts]) {
        if (row.questionId) questionIds.set(String(row.questionId), row.questionId);
    }

    const questions = questionIds.size
        ? await db.collection("grasp_question")
            .find(
                { _id: { $in: [...questionIds.values()] } },
                {
                    projection: {
                        title: 1, stem: 1, questionType: 1, type: 1, bloom: 1,
                        granularObjectiveId: 1, options: 1, correctAnswer: 1,
                    },
                }
            )
            .toArray()
        : [];

    return { ...summarizeQuestionStats(attempts, questions), ...DEFAULT_THRESHOLDS };
}

const SCORE_BIN_LABELS = ["0–9", "10–19", "20–29", "30–39", "40–49", "50–59", "60–69", "70–79", "80–89", "90–100"];

function median(sorted) {
    if (sorted.length === 0) return null;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

const average = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);

/**
 * Per-quiz class statistics. Pure, so it is unit-tested without a database.
 *
 * "Assigned" students are those in a section the quiz is scheduled for (the
 * only students who can take it), plus anyone who submitted regardless. Score
 * figures are withheld below the minimums; assigned and submitted
 * counts are participation, not performance, so they are always shown.
 *
 * @param {Object} input
 * @param {Array} input.quizzes - { _id, name }
 * @param {Array} input.students - cohort, { userId, sections: sectionId[] }
 * @param {Map<string, Set<string>>} input.scheduledSections - quizId -> sectionIds
 * @param {Array} input.scores - grasp_quiz_score rows of cohort students
 * @param {Map<string, Set<string>>} input.pendingUsers - quizId -> userIds
 *   with answers awaiting grading
 */
function summarizeQuizStats(
    { quizzes, students, scheduledSections, scores, pendingUsers },
    thresholds = DEFAULT_THRESHOLDS
) {
    const scoresByQuiz = new Map();
    for (const score of scores) {
        const key = String(score.quizId);
        if (!scoresByQuiz.has(key)) scoresByQuiz.set(key, []);
        scoresByQuiz.get(key).push(score);
    }

    const allSubmittedScores = [];
    const submittingStudents = new Set();
    let totalAssigned = 0;
    let totalSubmitted = 0;

    const rows = quizzes.map((quiz) => {
        const quizKey = String(quiz._id);
        const quizScores = scoresByQuiz.get(quizKey) || [];
        const submittedIds = new Set(quizScores.map((score) => String(score.userId)));
        const sections = scheduledSections.get(quizKey) || new Set();
        const assigned = students.filter(
            (student) =>
                submittedIds.has(String(student.userId))
                || student.sections.some((sectionId) => sections.has(sectionId))
        ).length;

        const submitted = quizScores.length;
        // One score row per student, so submissions are also distinct students.
        const enoughData = meetsThresholds(submitted, submitted, thresholds);
        const values = quizScores.map((score) => Number(score.score) || 0).sort((a, b) => a - b);
        const times = quizScores
            .map((score) => Number(score.timeSpent))
            .filter((ms) => Number.isFinite(ms) && ms > 0);

        let distribution = null;
        if (enoughData) {
            distribution = SCORE_BIN_LABELS.map((label) => ({ label, count: 0 }));
            for (const value of values) {
                distribution[Math.min(9, Math.max(0, Math.floor(value / 10)))].count += 1;
            }
        }

        totalAssigned += assigned;
        totalSubmitted += submitted;
        allSubmittedScores.push(...values);
        for (const id of submittedIds) submittingStudents.add(id);

        const pending = pendingUsers.get(quizKey);
        return {
            quizId: quizKey,
            name: quiz.name || "Untitled quiz",
            assigned,
            submitted,
            completionRate: assigned ? submitted / assigned : null,
            enoughData,
            meanScore: enoughData ? average(values) : null,
            medianScore: enoughData ? median(values) : null,
            averageTimeSpent: enoughData && times.length ? average(times) : null,
            distribution,
            // Scores still awaiting grading may rise once graded.
            pendingSubmissions: pending
                ? quizScores.filter((score) => pending.has(String(score.userId))).length
                : 0,
        };
    });

    return {
        quizzes: rows,
        summary: {
            totalQuizzes: rows.length,
            assigned: totalAssigned,
            submitted: totalSubmitted,
            completionRate: totalAssigned ? totalSubmitted / totalAssigned : null,
            meanScore: meetsThresholds(allSubmittedScores.length, submittingStudents.size, thresholds)
                ? average(allSubmittedScores)
                : null,
        },
    };
}

/**
 * Quiz analytics for a course's published quizzes, or for one quiz.
 *
 * @param {string} courseId
 * @param {Object} options
 * @param {string|null} options.quizId
 * @param {Array} options.students - from getCohortStudents
 */
async function getQuizAnalytics(courseId, { quizId = null, students }) {
    const db = await databaseService.connect();
    const courseIdObj = toId(courseId);

    const quizzes = await db.collection("grasp_quiz")
        .find(
            quizId ? { _id: toId(quizId), courseId: courseIdObj } : { courseId: courseIdObj, published: true },
            { projection: { name: 1, createdAt: 1 } }
        )
        .sort({ createdAt: 1 })
        .toArray();
    const quizIds = quizzes.map((quiz) => quiz._id);
    const studentIds = students.map((student) => toId(student.userId));

    const [courseSections, schedules, scores, pending] = quizIds.length
        ? await Promise.all([
            db.collection("grasp_course_section")
                .find({ courseId: courseIdObj }, { projection: { sectionId: 1 } })
                .toArray(),
            db.collection("grasp_quiz_section_schedule")
                .find({ quizId: { $in: quizIds } }, { projection: { quizId: 1, courseSectionId: 1 } })
                .toArray(),
            studentIds.length
                ? db.collection("grasp_quiz_score")
                    .find(
                        { quizId: { $in: quizIds }, userId: { $in: studentIds } },
                        { projection: { quizId: 1, userId: 1, score: 1, timeSpent: 1 } }
                    )
                    .toArray()
                : [],
            studentIds.length
                ? db.collection("grasp_student_attempt")
                    .aggregate([
                        {
                            $match: {
                                quizId: { $in: quizIds },
                                userId: { $in: studentIds },
                                isCorrect: null,
                                isFirstAttempt: { $ne: false },
                            },
                        },
                        { $group: { _id: { quizId: "$quizId", userId: "$userId" } } },
                    ])
                    .toArray()
                : [],
        ])
        : [[], [], [], []];

    // Schedules point at the section document; cohort students carry the
    // section's sectionId string.
    const sectionIdByDocId = new Map(courseSections.map((section) => [String(section._id), section.sectionId]));
    const scheduledSections = new Map();
    for (const schedule of schedules) {
        const key = String(schedule.quizId);
        if (!scheduledSections.has(key)) scheduledSections.set(key, new Set());
        const sectionId = sectionIdByDocId.get(String(schedule.courseSectionId));
        if (sectionId) scheduledSections.get(key).add(sectionId);
    }

    const pendingUsers = new Map();
    for (const { _id } of pending) {
        const key = String(_id.quizId);
        if (!pendingUsers.has(key)) pendingUsers.set(key, new Set());
        pendingUsers.get(key).add(String(_id.userId));
    }

    return {
        ...summarizeQuizStats({ quizzes, students, scheduledSections, scores, pendingUsers }),
        ...DEFAULT_THRESHOLDS,
    };
}

const isParentObjective = (objective) => objective.parent === 0 || objective.parent === "0";

// A student has mastered an objective with at least minAnswers graded answers
// on it, at least `threshold` of them correct. 80% is the default for now;
// it is a parameter so it can become a course setting later.
const DEFAULT_MASTERY = { threshold: 0.8, minAnswers: 2 };

const REMEDIATION_RANKING_LIMIT = 5;

/**
 * Class performance per learning objective, for each granular objective and
 * rolled up to its parent. Pure, so it is unit-tested without a database.
 *
 * - Correct: share of graded responses on the objective that were correct.
 * - Mastery rate: of the students with enough graded answers on the
 *   objective to judge (mastery.minAnswers), the share who reached
 *   mastery.threshold correct.
 * - Needs remediation: how many students the adaptive engine currently flags
 *   for remediation on the objective (grasp_student_performance). This is the
 *   engine's present state for each student, so it is not narrowed to a quiz.
 *
 * Each figure is withheld unless it rests on enough responses from enough
 * different students (thresholds). An answer is filed under its question's
 * granular objective and that objective's parent; one recorded against a
 * parent only (no granular) counts toward the parent alone. Objectives nobody
 * has been assessed on are still listed, with no data.
 *
 * @param {Array} attempts - { userId, questionId, isCorrect,
 *   learningObjectiveId, granularObjectiveId }
 * @param {Array} objectives - the course's grasp_objective docs (parents have
 *   parent === 0; granular objectives hold their parent's _id)
 * @param {Object} [options]
 * @param {Array} [options.performance] - grasp_student_performance rows of
 *   cohort students: { userId, learningObjectiveId, granularObjectiveId,
 *   needsRemediation }
 * @param {Object} [options.thresholds] - { minResponses, minStudents }
 * @param {Object} [options.mastery] - { threshold, minAnswers }
 */
function summarizeObjectiveStats(
    attempts,
    objectives,
    { performance = [], thresholds = DEFAULT_THRESHOLDS, mastery = DEFAULT_MASTERY } = {}
) {
    const parents = objectives.filter(isParentObjective);
    const parentIds = new Set(parents.map((parent) => String(parent._id)));
    const parentOfGranular = new Map();
    for (const objective of objectives) {
        if (parentIds.has(String(objective.parent))) {
            parentOfGranular.set(String(objective._id), String(objective.parent));
        }
    }

    // perStudent: userId -> { correct, graded } on this objective.
    const newTally = () => ({ correct: 0, incorrect: 0, pending: 0, questions: new Set(), perStudent: new Map() });
    const tallies = new Map();
    const add = (objectiveId, attempt) => {
        if (!tallies.has(objectiveId)) tallies.set(objectiveId, newTally());
        const tally = tallies.get(objectiveId);
        if (attempt.isCorrect === true) tally.correct += 1;
        else if (attempt.isCorrect === false) tally.incorrect += 1;
        else {
            tally.pending += 1;
            return;
        }
        tally.questions.add(String(attempt.questionId));
        const userKey = String(attempt.userId);
        const student = tally.perStudent.get(userKey) || { correct: 0, graded: 0 };
        student.graded += 1;
        if (attempt.isCorrect === true) student.correct += 1;
        tally.perStudent.set(userKey, student);
    };

    // The engine keys its state by the parent objective, or by the granular
    // one when a question has no parent.
    const remediation = new Map();
    for (const row of performance) {
        const objectiveId = row.learningObjectiveId
            ? String(row.learningObjectiveId)
            : row.granularObjectiveId ? String(row.granularObjectiveId) : null;
        if (!objectiveId) continue;
        if (!remediation.has(objectiveId)) remediation.set(objectiveId, { tracked: new Set(), flagged: new Set() });
        const entry = remediation.get(objectiveId);
        entry.tracked.add(String(row.userId));
        if (row.needsRemediation === true) entry.flagged.add(String(row.userId));
    }

    for (const attempt of attempts) {
        const granularId = attempt.granularObjectiveId ? String(attempt.granularObjectiveId) : null;
        if (granularId && parentOfGranular.has(granularId)) {
            add(granularId, attempt);
            add(parentOfGranular.get(granularId), attempt);
        } else if (attempt.learningObjectiveId && parentIds.has(String(attempt.learningObjectiveId))) {
            add(String(attempt.learningObjectiveId), attempt);
        }
    }

    const toRow = (objective) => {
        const objectiveId = String(objective._id);
        const tally = tallies.get(objectiveId) || newTally();
        const responses = tally.correct + tally.incorrect;
        const enoughData = meetsThresholds(responses, tally.perStudent.size, thresholds);

        // Mastery is judged only for students with enough answers, and rated
        // only when enough of them (and their answers) are behind it.
        const judged = [...tally.perStudent.values()].filter((s) => s.graded >= mastery.minAnswers);
        const judgedResponses = judged.reduce((sum, s) => sum + s.graded, 0);
        const enoughMasteryData = meetsThresholds(judgedResponses, judged.length, thresholds);
        const mastered = judged.filter((s) => s.correct / s.graded >= mastery.threshold).length;

        const engine = remediation.get(objectiveId);
        const tracked = engine ? engine.tracked.size : 0;
        // A count over too few students would say who needs help.
        const enoughRemediationData = tracked >= thresholds.minStudents;
        const flagged = engine ? engine.flagged.size : 0;

        return {
            objectiveId,
            name: objective.name || "Untitled objective",
            responses,
            pending: tally.pending,
            questionsAssessed: tally.questions.size,
            studentsAssessed: tally.perStudent.size,
            enoughData,
            pValue: enoughData ? tally.correct / responses : null,
            masteryJudged: judged.length,
            enoughMasteryData,
            mastered: enoughMasteryData ? mastered : null,
            masteryRate: enoughMasteryData ? mastered / judged.length : null,
            remediationTracked: tracked,
            enoughRemediationData,
            needsRemediation: enoughRemediationData ? flagged : null,
            remediationRate: enoughRemediationData ? flagged / tracked : null,
        };
    };

    const rows = parents.map((parent) => ({
        ...toRow(parent),
        granular: objectives
            .filter((objective) => String(objective.parent) === String(parent._id))
            .map(toRow),
    }));

    const rated = rows.filter((row) => row.enoughData);
    const masteryRated = rows.filter((row) => row.enoughMasteryData);

    // Ranked over every objective, parent or granular, that has a remediation
    // figure: most students flagged first, then the larger share flagged.
    const remediationRanking = rows
        .flatMap((row) => [row, ...row.granular])
        .filter((row) => row.enoughRemediationData && row.needsRemediation > 0)
        .sort((a, b) => b.needsRemediation - a.needsRemediation || b.remediationRate - a.remediationRate)
        .slice(0, REMEDIATION_RANKING_LIMIT)
        .map((row) => row.objectiveId);

    return {
        objectives: rows,
        summary: {
            totalObjectives: rows.length,
            ratedObjectives: rated.length,
            gradedResponses: rows.reduce((sum, row) => sum + row.responses, 0),
            pendingResponses: rows.reduce((sum, row) => sum + row.pending, 0),
            averagePValue: average(rated.map((row) => row.pValue)),
            averageMasteryRate: average(masteryRated.map((row) => row.masteryRate)),
            weakestObjectiveId: rated.length
                ? [...rated].sort((a, b) => a.pValue - b.pValue)[0].objectiveId
                : null,
            remediationRanking,
        },
    };
}

/**
 * Objective analytics for a course, or for the answers given in one quiz.
 *
 * @param {string} courseId
 * @param {Object} options
 * @param {string|null} options.quizId
 * @param {Array} options.studentIds - from getCohortStudentIds
 */
async function getObjectiveAnalytics(courseId, { quizId = null, studentIds }) {
    const db = await databaseService.connect();
    const courseIdObj = toId(courseId);

    const objectives = await db.collection("grasp_objective")
        .find({ courseId: courseIdObj }, { projection: { name: 1, parent: 1, createdAt: 1 } })
        .sort({ createdAt: 1 })
        .toArray();

    let quizIds;
    if (quizId) {
        quizIds = [toId(quizId)];
    } else {
        const quizzes = await db.collection("grasp_quiz")
            .find({ courseId: courseIdObj }, { projection: { _id: 1 } })
            .toArray();
        quizIds = quizzes.map((quiz) => quiz._id);
    }

    const attempts = quizIds.length && studentIds.length
        ? await db.collection("grasp_student_attempt")
            .find(
                {
                    quizId: { $in: quizIds },
                    userId: { $in: studentIds.map(toId) },
                    isFirstAttempt: { $ne: false },
                },
                {
                    projection: {
                        userId: 1, questionId: 1, isCorrect: 1,
                        learningObjectiveId: 1, granularObjectiveId: 1,
                    },
                }
            )
            .toArray()
        : [];

    // The engine's current state: course-wide, whatever quiz is selected.
    const performance = studentIds.length
        ? await db.collection("grasp_student_performance")
            .find(
                { courseId: courseIdObj, userId: { $in: studentIds.map(toId) } },
                { projection: { userId: 1, learningObjectiveId: 1, granularObjectiveId: 1, needsRemediation: 1 } }
            )
            .toArray()
        : [];

    return {
        ...summarizeObjectiveStats(attempts, objectives, { performance }),
        ...DEFAULT_THRESHOLDS,
        mastery: DEFAULT_MASTERY,
    };
}

module.exports = {
    MIN_RESPONSES,
    MIN_STUDENTS,
    DEFAULT_MASTERY,
    difficultyBand,
    summarizeQuestionStats,
    summarizeQuizStats,
    summarizeObjectiveStats,
    canViewSection,
    getCohortStudents,
    getCohortStudentIds,
    getQuestionAnalytics,
    getQuizAnalytics,
    getObjectiveAnalytics,
};
