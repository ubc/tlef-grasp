// The gradable object a scheduled GRASP quiz has in an LMS (issue #125): one
// row per quiz per GRASP section, in grasp_quiz_lms_assignment. The row is how
// GRASP knows an assignment already exists (no duplicates), where it is (for
// due-date updates and, later, grade export), and whether the instructor
// declined to create one.
//
// Row shape:
//   { quizId, courseSectionId, courseId,
//     provider: 'canvas', instance, externalCourseId, externalSectionId,
//     status: 'pending' | 'created' | 'declined',
//     externalAssignmentId, externalOverrideId, name, htmlUrl, dueAt, syncedAt,
//     lastError: { message, at } | null,
//     createdBy, createdAt, updatedAt }
//
// Creating in Canvas is not atomic with the row, so a row is CLAIMED first
// (status 'pending', unique on quiz + section) and filled in once Canvas has
// answered. A claim that never completes is taken over after CLAIM_TTL_MS.

const { ObjectId } = require('mongodb');
const databaseService = require('./database');

const COLLECTION = 'grasp_quiz_lms_assignment';

const STATUS = Object.freeze({
  PENDING: 'pending',
  CREATED: 'created',
  DECLINED: 'declined',
});

// A 'pending' row older than this belongs to a request that died mid-create.
const CLAIM_TTL_MS = 2 * 60 * 1000;

const MONGO_DUPLICATE_KEY = 11000;

const toObjectId = (id) =>
  typeof id === 'string' && ObjectId.isValid(id) ? new ObjectId(id) : id;

const collection = async () => (await databaseService.connect()).collection(COLLECTION);

/** Rows for one quiz, keyed by GRASP section id. */
async function getRowsForQuiz(quizId) {
  const rows = await (await collection()).find({ quizId: toObjectId(quizId) }).toArray();
  return new Map(rows.map((row) => [row.courseSectionId.toString(), row]));
}

/** Rows for one GRASP section, keyed by quiz id. */
async function getRowsForSection(courseSectionId) {
  const rows = await (await collection())
    .find({ courseSectionId: toObjectId(courseSectionId) })
    .toArray();
  return new Map(rows.map((row) => [row.quizId.toString(), row]));
}

/**
 * Claim the right to create this quiz/section's assignment. Succeeds when no
 * row exists, when the row is a decline (the instructor changed their mind),
 * or when a previous claim has expired. Returns the claimed row and the status
 * it had before, so a failed create can put it back; null when another request
 * holds a live claim or the assignment already exists.
 *
 * @returns {Promise<{ row: Object, previousStatus: string|null } | null>}
 */
async function claimRow({ quizId, courseSectionId, courseId, provider, instance, externalCourseId, externalSectionId, userId }) {
  const col = await collection();
  const now = new Date();
  const base = {
    quizId: toObjectId(quizId),
    courseSectionId: toObjectId(courseSectionId),
  };
  const claim = {
    courseId: toObjectId(courseId),
    provider,
    instance,
    externalCourseId: String(externalCourseId),
    externalSectionId: String(externalSectionId),
    status: STATUS.PENDING,
    updatedAt: now,
  };

  try {
    const { insertedId } = await col.insertOne({
      ...base,
      ...claim,
      createdBy: toObjectId(userId),
      createdAt: now,
    });
    return { row: { _id: insertedId, ...base, ...claim }, previousStatus: null };
  } catch (error) {
    if (error?.code !== MONGO_DUPLICATE_KEY) throw error;
  }

  // A row exists: take it over only if it is a decline or a dead claim.
  const existing = await col.findOne(base);
  if (!existing) return null;
  const previousStatus = existing.status;
  const takeable =
    previousStatus === STATUS.DECLINED ||
    (previousStatus === STATUS.PENDING && existing.updatedAt < new Date(now.getTime() - CLAIM_TTL_MS));
  if (!takeable) return null;

  // Guarded by the status and timestamp just read, so two takeovers of the
  // same dead claim cannot both succeed.
  const result = await col.findOneAndUpdate(
    { _id: existing._id, status: previousStatus, updatedAt: existing.updatedAt },
    { $set: { ...claim, createdBy: toObjectId(userId) }, $unset: { lastError: '' } },
    { returnDocument: 'after' }
  );
  const row = result && (result.value !== undefined ? result.value : result);
  return row ? { row, previousStatus } : null;
}

/** Undo a claim whose create failed: back to the decline it replaced, or gone. */
async function releaseClaim(row, previousStatus, error) {
  const col = await collection();
  if (previousStatus === STATUS.DECLINED) {
    await col.updateOne(
      { _id: row._id, status: STATUS.PENDING },
      { $set: { status: STATUS.DECLINED, updatedAt: new Date(), lastError: errorRecord(error) } }
    );
  } else {
    await col.deleteOne({ _id: row._id, status: STATUS.PENDING });
  }
}

/** Fill a claimed row in with the assignment Canvas now holds. */
async function markCreated(rowId, { externalAssignmentId, externalOverrideId, name, htmlUrl, dueAt }) {
  const now = new Date();
  await (await collection()).updateOne(
    { _id: rowId },
    {
      $set: {
        status: STATUS.CREATED,
        externalAssignmentId: String(externalAssignmentId),
        externalOverrideId: externalOverrideId == null ? null : String(externalOverrideId),
        name,
        htmlUrl: htmlUrl || null,
        dueAt: dueAt || null,
        syncedAt: now,
        updatedAt: now,
      },
      $unset: { lastError: '' },
    }
  );
}

/** Record that the due date in Canvas now matches GRASP's. */
async function markSynced(rowId, { dueAt, externalOverrideId }) {
  const now = new Date();
  const set = { dueAt: dueAt || null, syncedAt: now, updatedAt: now };
  if (externalOverrideId !== undefined) set.externalOverrideId = externalOverrideId == null ? null : String(externalOverrideId);
  await (await collection()).updateOne({ _id: rowId }, { $set: set, $unset: { lastError: '' } });
}

/** Keep the row, remember why the last Canvas update failed (the chip shows it). */
async function markSyncFailed(rowId, error) {
  await (await collection()).updateOne(
    { _id: rowId },
    { $set: { lastError: errorRecord(error), updatedAt: new Date() } }
  );
}

/**
 * Remember that the instructor declined to create assignments for these
 * sections, so GRASP stops asking. An existing assignment is never touched.
 * @returns {Promise<string[]>} the section ids now recorded as declined
 */
async function markDeclined({ quizId, courseSectionIds, courseId, provider, instance, userId }) {
  const col = await collection();
  const now = new Date();
  const declined = [];
  for (const courseSectionId of courseSectionIds) {
    const result = await col.updateOne(
      {
        quizId: toObjectId(quizId),
        courseSectionId: toObjectId(courseSectionId),
        status: { $ne: STATUS.CREATED },
      },
      {
        $set: { status: STATUS.DECLINED, provider, instance, updatedAt: now },
        $setOnInsert: {
          quizId: toObjectId(quizId),
          courseSectionId: toObjectId(courseSectionId),
          courseId: toObjectId(courseId),
          createdBy: toObjectId(userId),
          createdAt: now,
        },
      },
      { upsert: true }
    ).catch((error) => {
      // The upsert raced a create for the same section: that row is 'created'
      // now, which is not something a decline may overwrite.
      if (error?.code === MONGO_DUPLICATE_KEY) return null;
      throw error;
    });
    if (result && (result.upsertedCount || result.matchedCount)) declined.push(String(courseSectionId));
  }
  return declined;
}

/** Quiz-delete cleanup. The Canvas assignments stay; only GRASP's record goes. */
async function removeForQuiz(quizId) {
  return (await collection()).deleteMany({ quizId: toObjectId(quizId) });
}

/** Section-recycle cleanup. As above, nothing in Canvas is touched. */
async function removeForSection(courseSectionId) {
  return (await collection()).deleteMany({ courseSectionId: toObjectId(courseSectionId) });
}

function errorRecord(error) {
  return { message: String(error?.message || error || 'Unknown error').slice(0, 500), at: new Date() };
}

/** What the browser may know about a row. */
function publicAssignment(row) {
  if (!row || row.status === STATUS.PENDING) return null;
  if (row.status === STATUS.DECLINED) {
    return { status: STATUS.DECLINED, lastError: row.lastError ? { message: row.lastError.message, at: row.lastError.at } : null };
  }
  return {
    status: STATUS.CREATED,
    externalAssignmentId: String(row.externalAssignmentId),
    name: row.name || '',
    htmlUrl: row.htmlUrl || null,
    dueAt: row.dueAt || null,
    syncedAt: row.syncedAt || null,
    lastError: row.lastError ? { message: row.lastError.message, at: row.lastError.at } : null,
  };
}

module.exports = {
  COLLECTION,
  STATUS,
  CLAIM_TTL_MS,
  getRowsForQuiz,
  getRowsForSection,
  claimRow,
  releaseClaim,
  markCreated,
  markSynced,
  markSyncFailed,
  markDeclined,
  removeForQuiz,
  removeForSection,
  publicAssignment,
};
