/**
 * Course access audit log (issue #115).
 *
 * Instructors can grant course access to anyone who has signed in to GRASP,
 * outside of the academic-API roster. Every grant, role change, and
 * revocation is appended here so that "who approved this person, and when"
 * can always be answered — including after the membership itself has been
 * removed, when nothing on grasp_user_course remains to consult.
 *
 * Append-only: rows are never updated or deleted by the application.
 */

const databaseService = require('./database');
const { ObjectId } = require('mongodb');

const COLLECTION = 'grasp_course_access_log';

const ACCESS_ACTIONS = {
  ADDED: 'added',
  PROMOTED: 'promoted',
  DEMOTED: 'demoted',
  REMOVED: 'removed',
  PERMISSIONS_UPDATED: 'permissions-updated',
};

const KNOWN_ACTIONS = new Set(Object.values(ACCESS_ACTIONS));

function toObjectId(value) {
  if (value instanceof ObjectId) return value;
  const asString = String(value ?? '');
  return ObjectId.isValid(asString) ? new ObjectId(asString) : value;
}

/**
 * Append one event. Best-effort by design: the membership document already
 * carries the primary who/when stamps, so a failure here is logged loudly
 * but must not leave the instructor's action half-applied from their point
 * of view. Returns the stored event, or null when it could not be written.
 *
 * @param {Object} event
 * @param {string|ObjectId} event.courseId
 * @param {string|ObjectId} event.targetUserId - The user whose access changed
 * @param {string|ObjectId} event.actorUserId - The instructor who changed it
 * @param {string} event.action - One of ACCESS_ACTIONS
 * @param {string|null} [event.role] - The course role granted/held ('ta', 'student', 'staff')
 * @param {Object|null} [event.details] - Free-form extra context (e.g. a permission map)
 */
async function recordCourseAccessEvent({ courseId, targetUserId, actorUserId, action, role = null, details = null }) {
  if (!courseId || !targetUserId || !actorUserId || !action) {
    throw new Error('courseId, targetUserId, actorUserId and action are required');
  }
  if (!KNOWN_ACTIONS.has(action)) {
    throw new Error(`Unknown course access action: ${action}`);
  }

  const event = {
    courseId: toObjectId(courseId),
    targetUserId: toObjectId(targetUserId),
    actorUserId: toObjectId(actorUserId),
    action,
    role: role || null,
    createdAt: new Date(),
  };
  if (details && typeof details === 'object') event.details = details;

  try {
    const db = await databaseService.connect();
    const result = await db.collection(COLLECTION).insertOne(event);
    return { ...event, _id: result.insertedId };
  } catch (error) {
    console.error('Error recording course access event:', error, event);
    return null;
  }
}

/**
 * Newest-first events for one course, with the actor and target resolved to
 * their name fields so the Users page can render them without extra lookups.
 * @param {string|ObjectId} courseId
 * @param {{ limit?: number }} [options]
 * @returns {Promise<Array>}
 */
async function getCourseAccessLog(courseId, { limit = 100 } = {}) {
  try {
    const db = await databaseService.connect();
    const userLookup = (localField, as) => ({
      $lookup: {
        from: 'grasp_user',
        let: { lookupId: `$${localField}` },
        pipeline: [
          { $match: { $expr: { $eq: ['$_id', '$$lookupId'] } } },
          { $project: { _id: 1, displayName: 1, legalName: 1, email: 1 } },
        ],
        as,
      },
    });

    return db
      .collection(COLLECTION)
      .aggregate([
        { $match: { courseId: toObjectId(courseId) } },
        { $sort: { createdAt: -1 } },
        { $limit: Math.max(1, Math.min(Number(limit) || 100, 500)) },
        userLookup('actorUserId', 'actor'),
        userLookup('targetUserId', 'target'),
        {
          $project: {
            _id: 1,
            action: 1,
            role: 1,
            details: 1,
            createdAt: 1,
            actorUserId: 1,
            targetUserId: 1,
            actor: { $first: '$actor' },
            target: { $first: '$target' },
          },
        },
      ])
      .toArray();
  } catch (error) {
    console.error('Error reading course access log:', error);
    throw error;
  }
}

module.exports = {
  ACCESS_ACTIONS,
  COURSE_ACCESS_LOG_COLLECTION: COLLECTION,
  recordCourseAccessEvent,
  getCourseAccessLog,
};
