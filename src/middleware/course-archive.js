/**
 * Archived-course enforcement.
 *
 * Archiving a course (GRASP's soft delete) has to do two different things to
 * two different audiences, and neither can be done by filtering course lists:
 *
 *  1. Students, co-instructors, and TAs lose access outright. Hiding the course
 *     from their list is not enough — `hasStaffAccessInCourse` grants any
 *     faculty user staff-level access to any course, member or not, so a
 *     co-instructor who is faculty would keep full API access to a course that
 *     had merely vanished from their sidebar.
 *  2. The owner keeps access, but read-only. That guarantee has to hold against
 *     a request, not against which buttons the client chose to render.
 *
 * Hence this gate:
 *
 *   | requester        | GET     | POST/PUT/PATCH/DELETE |
 *   | owner / app admin| allow   | 403 course_archived   |
 *   | anyone else      | 403     | 403 course_archived   |
 *
 * The archive/unarchive endpoints are exempt by being declared ahead of the
 * gate in `routes/courses.js` — they are the way back out.
 *
 * A request whose course cannot be resolved passes straight through. This is an
 * archived-state gate, not an authorization layer: the existing
 * `hasStaffAccessInCourse` / `assertCoInstructorPermission` / `assertTaPermission`
 * checks stay where they are and still run.
 */

const { getCourseById } = require('../services/course');
const { isCourseManager } = require('../utils/co-instructor-permissions');

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const ARCHIVED_ERROR = 'course_archived';

const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;

/**
 * Routers mount several layers of this gate (one per way a course id can
 * arrive), so a request commonly passes through two or three of them. Remember
 * the ids already cleared on this request so the later layers skip the repeat
 * lookup rather than re-reading the same course document.
 */
function alreadyCleared(req, courseId) {
    const key = String(courseId);
    if (!req.__activeCourseChecked) req.__activeCourseChecked = new Set();
    if (req.__activeCourseChecked.has(key)) return true;
    req.__activeCourseChecked.add(key);
    return false;
}

/**
 * Build the gate. Without options it reads the course id from
 * `req.params.courseId`, `req.body.courseId`, then `req.query.courseId` — which
 * covers every route that names the course directly.
 *
 * Routes keyed by a child resource (a quiz, question, objective, or material id)
 * pass a resolver:
 *
 *   router.get('/:quizId', requireActiveCourse({ resolve: resolveCourseFromQuiz }), handler)
 *
 * Mount it AFTER the body parser on routes whose course id arrives in the body,
 * or `req.body` will still be undefined when the gate runs.
 *
 * @param {Object} [options]
 * @param {(req) => Promise<string|null>} [options.resolve] - Fallback resolver
 * @returns {import('express').RequestHandler}
 */
function requireActiveCourse({ resolve } = {}) {
    return async function courseArchiveGate(req, res, next) {
        try {
            let courseId =
                req.params?.courseId || req.body?.courseId || req.query?.courseId;

            if (!courseId && typeof resolve === 'function') {
                // A resolver looks up a child resource (quiz, question,
                // material, objective) that may simply not exist. That is not
                // this middleware's problem to report — let the route's own
                // handler produce its usual 404 rather than turning a missing
                // id into a 500 here.
                try {
                    courseId = await resolve(req);
                } catch (resolveError) {
                    console.error(
                        '[requireActiveCourse] Resolver failed; passing through:',
                        resolveError.message
                    );
                    return next();
                }
            }
            if (!courseId) return next();
            if (alreadyCleared(req, courseId)) return next();

            const course = await getCourseById(courseId);
            if (!course || course.archived !== true) return next();

            // Past this point the course is archived.
            if (!(await isCourseManager(req.user, courseId))) {
                return res.status(403).json({
                    error: ARCHIVED_ERROR,
                    message: 'This course has been archived by its instructor.',
                });
            }

            if (READ_METHODS.has(req.method)) return next();

            return res.status(403).json({
                error: ARCHIVED_ERROR,
                message:
                    'This course is archived and read-only. Unarchive it to make changes.',
            });
        } catch (error) {
            console.error('[requireActiveCourse] Error resolving course:', error);
            return next(error);
        }
    };
}

// --- Resolvers for routes keyed by a child resource -------------------------

const resolveCourseFromQuiz = async (req) => {
    const quizId = req.params?.quizId;
    // A layer mounted at "/:quizId" also matches literal segments on sibling
    // routes ("/course/...", "/flags/..."). Those can never be an id, so skip
    // the lookup instead of paying for a miss on every such request.
    if (!OBJECT_ID_PATTERN.test(String(quizId || ''))) return null;
    const { getQuizById } = require('../services/quiz');
    const quiz = await getQuizById(quizId);
    return quiz?.courseId || null;
};

const resolveCourseFromQuestion = async (req) => {
    const questionId = req.params?.questionId;
    if (!OBJECT_ID_PATTERN.test(String(questionId || ''))) return null;
    const { getQuestionCourseId } = require('../services/question');
    return (await getQuestionCourseId(questionId)) || null;
};

// getMaterialCourseId throws on a missing material, so go through
// getMaterialBySourceId, which returns null instead.
const resolveCourseFromMaterial = async (req) => {
    const sourceId = req.params?.sourceId;
    if (!sourceId) return null;
    const { getMaterialBySourceId } = require('../services/material');
    const material = await getMaterialBySourceId(sourceId);
    return material?.courseId || null;
};

const resolveCourseFromObjective = async (req) => {
    const objectiveId = req.params?.id;
    if (!OBJECT_ID_PATTERN.test(String(objectiveId || ''))) return null;
    const { getObjectiveById } = require('../services/objective');
    const objective = await getObjectiveById(objectiveId);
    return objective?.courseId || null;
};

module.exports = {
    requireActiveCourse,
    resolveCourseFromQuiz,
    resolveCourseFromQuestion,
    resolveCourseFromMaterial,
    resolveCourseFromObjective,
    ARCHIVED_ERROR,
};
