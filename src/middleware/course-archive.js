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
 * Where a course id can be hiding in a request.
 *
 * `courseId` in the params, body, or query covers most routes, but three
 * handlers name it differently and would otherwise slip past the gate
 * entirely:
 *   - POST /api/rag-llm/add-document accepts `metadata.courseId` as an
 *     alternative to a top-level `courseId` (controllers/rag-llm.js).
 *   - POST /api/rag-llm/review-questions carries it only on the questions
 *     themselves, as `questions[0].courseId`.
 *   - POST /api/question/export calls the field `course`.
 *
 * Keep this list in step with those handlers: a shape missing here is a write
 * that reaches an archived course.
 */
function isUsableId(value) {
    // Reject objects and empty strings — `course` in particular is an id on the
    // export route but must not be trusted blindly if a caller sends an object.
    return (
        (typeof value === 'string' && value.trim() !== '') ||
        (value && typeof value === 'object' && typeof value.toHexString === 'function')
    );
}

function courseIdFromRequest(req) {
    const candidates = [
        req.params?.courseId,
        req.body?.courseId,
        req.body?.metadata?.courseId,
        req.body?.course,
        Array.isArray(req.body?.questions) ? req.body.questions[0]?.courseId : undefined,
        req.query?.courseId,
    ];
    return candidates.find(isUsableId) || null;
}

/**
 * Build the gate. Without options it reads the course id from
 * `req.params.courseId`, `req.body.courseId`, then `req.query.courseId` — which
 * covers every route that names the course directly.
 *
 * Routes keyed by a child resource (a quiz, question, objective, material, or
 * image id) pass a resolver:
 *
 *   router.get('/:quizId', requireActiveCourse({ resolve: resolveCourseFromQuiz }), handler)
 *
 * A supplied resolver ALWAYS runs, even when the request also names a course.
 * It must, because the request-supplied id is attacker-controlled: given
 * `GET /api/image/:fileId?courseId=<a live course>`, trusting the query string
 * would clear a live course and never look at the archived course the image
 * actually belongs to. Every course a request touches is checked, and any one
 * of them being archived refuses the request.
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
            const candidates = [];

            const claimed = courseIdFromRequest(req);
            if (claimed) candidates.push(claimed);

            if (typeof resolve === 'function') {
                // A resolver reports a child resource that does not exist by
                // returning null, which leaves the route's own handler to
                // produce its usual 404. A THROW is different: it means the
                // lookup itself failed, and the gate cannot tell whether the
                // course behind it is archived. Failing open there would let a
                // request through on a transient database error and act on an
                // archived course if the handler's own lookup then succeeded,
                // so an operational failure propagates — the same thing that
                // already happens when getCourseById below fails.
                try {
                    const resolved = await resolve(req);
                    if (resolved) candidates.push(resolved);
                } catch (resolveError) {
                    console.error(
                        '[requireActiveCourse] Resolver failed:',
                        resolveError.message
                    );
                    return next(resolveError);
                }
            }

            for (const candidate of candidates) {
                const courseId = String(candidate);
                if (alreadyCleared(req, courseId)) continue;

                const course = await getCourseById(courseId);
                if (!course || course.archived !== true) continue;

                // Past this point the request touches an archived course.
                if (!(await isCourseManager(req.user, courseId))) {
                    return res.status(403).json({
                        error: ARCHIVED_ERROR,
                        message: 'This course has been archived by its instructor.',
                    });
                }

                if (!READ_METHODS.has(req.method)) {
                    return res.status(403).json({
                        error: ARCHIVED_ERROR,
                        message:
                            'This course is archived and read-only. Unarchive it to make changes.',
                    });
                }
            }

            return next();
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

// Images live in GridFS, not a grasp_* collection, and carry their course on
// the file's metadata. Students fetch these while taking a quiz, so this
// resolver is part of the hard cut, not just the write block.
const resolveCourseFromImage = async (req) => {
    const fileId = req.params?.fileId;
    if (!OBJECT_ID_PATTERN.test(String(fileId || ''))) return null;
    const { getImageCourseId } = require('../services/image');
    return (await getImageCourseId(fileId)) || null;
};

// Question-flag status updates are keyed only by the flag; the flag document
// carries its course directly.
const resolveCourseFromFlag = async (req) => {
    const flagId = req.params?.flagId;
    if (!OBJECT_ID_PATTERN.test(String(flagId || ''))) return null;
    const { getFlagById } = require('../services/quiz-question-flag');
    const flag = await getFlagById(flagId);
    return flag?.courseId || null;
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
    resolveCourseFromImage,
    resolveCourseFromFlag,
    ARCHIVED_ERROR,
};
