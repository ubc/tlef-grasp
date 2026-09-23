/**
 * Provider-neutral LMS roster sync for one GRASP section (issue #113).
 *
 * An LMS adapter (src/lms/adapters) reads the students of the LMS section a
 * GRASP section is linked to; this service reconciles GRASP's section
 * enrollments with that roster:
 *
 *   - roster students are matched to GRASP users on integration_id = PUID
 *     only (no email/SIS/name fallback — a wrong match files a student's work
 *     against someone else, a miss is just a line in the summary);
 *   - matched students with no row are added (a placeholder user is created
 *     for anyone who has never signed in), dropped rows are restored, active
 *     rows are kept;
 *   - active rows whose student is no longer on the roster are soft-dropped,
 *     behind three guards: the first sync after (re)linking always asks
 *     first, a sync that would drop more than half the section asks first, and
 *     a roster where too few rows carry integration_id drops no one at all.
 *
 * Asking first means returning a `confirmation-required` plan with nothing
 * applied; the instructor re-sends with the exact ids they agreed to drop (or
 * with skipDrops).
 */

const { ObjectId } = require('mongodb');
const databaseService = require('./database');
const { createOrUpdateUser, getUserByPuid, upsertUserLmsAccount } = require('./user');
const { createUserCourse, isUserInCourse, MEMBERSHIP_SOURCES } = require('./user-course');
const {
  upsertUserCourseSection,
  dropUserCourseSection,
  countActiveUserCourseSections,
  DROPPED_REASONS,
} = require('./course-section');
const { ACCESS_ACTIONS, recordCourseAccessEvent } = require('./course-access-log');
const { TA_COURSE_ROLE } = require('../utils/course-access');
const { LmsRosterError, ROSTER_ERROR_CODES } = require('../lms/roster-errors');

// Below this share of roster rows carrying integration_id, the unmatched rows
// are more likely a permission gap than real drops, so nobody is dropped.
const MIN_INTEGRATION_ID_COVERAGE = 0.8;
// A later sync dropping more than this share of the active section asks first.
const LARGE_DROP_RATIO = 0.5;

const SYNC_STATUS = {
  APPLIED: 'applied',
  CONFIRMATION_REQUIRED: 'confirmation-required',
};

const CONFIRMATION_REASONS = {
  FIRST_SYNC: 'first-sync',
  LARGE_DROP: 'large-drop',
  // The instructor confirmed a drop list, but the roster changed since the
  // preview and now someone else would be dropped too.
  ROSTER_CHANGED: 'roster-changed',
};

const DROPS_SKIPPED = {
  LOW_COVERAGE: 'low-coverage',
  INSTRUCTOR_SKIPPED: 'instructor-skipped',
};

const toObjectId = (id) =>
  typeof id === 'string' && ObjectId.isValid(id) ? new ObjectId(id) : id;

const isActiveRow = (row) => row.droppedAt === undefined || row.droppedAt === null;

// Instructor views prefer the legal name but must fall back: placeholders and
// never-synced users often have none.
const nameOf = (user, fallback = '') =>
  (user && (user.legalName || user.displayName || user.email)) || fallback || 'Unknown student';

/**
 * Pair roster rows with GRASP users by PUID. Rows without an integration_id
 * are returned as `unmatched`; a row whose PUID has no GRASP user yet is
 * matched with `user: null` (a placeholder is created when applying).
 */
async function resolveRoster(db, roster) {
  const unmatched = [];
  const keyed = [];
  const seen = new Set();
  for (const row of roster) {
    const integrationId = typeof row.integrationId === 'string' ? row.integrationId.trim() : '';
    if (!integrationId) {
      unmatched.push({ name: String(row.name || '') || 'Unknown student' });
      continue;
    }
    // One person listed twice (or with different casing) is still one person.
    const foldedKey = integrationId.toUpperCase();
    if (seen.has(foldedKey)) continue;
    seen.add(foldedKey);
    keyed.push({ row, integrationId });
  }

  // Exact PUID first, then its upper-cased form; both hit the unique puid index.
  const puids = [...new Set(keyed.flatMap(({ integrationId }) => [integrationId, integrationId.toUpperCase()]))];
  const users = puids.length > 0
    ? await db.collection('grasp_user')
      .find({ puid: { $in: puids } }, { projection: { _id: 1, puid: 1, displayName: 1, legalName: 1, email: 1 } })
      .toArray()
    : [];
  const byPuid = new Map(users.map((user) => [user.puid, user]));

  const matched = keyed.map(({ row, integrationId }) => ({
    row,
    integrationId,
    user: byPuid.get(integrationId) || byPuid.get(integrationId.toUpperCase()) || null,
  }));
  return { matched, unmatched };
}

async function loadMemberships(db, courseId, userIds) {
  if (userIds.length === 0) return new Map();
  const memberships = await db.collection('grasp_user_course').find({
    $and: [
      { $or: [{ courseId: toObjectId(String(courseId)) }, { courseId: String(courseId) }] },
      { userId: { $in: [...userIds, ...userIds.map(String)] } },
    ],
  }).toArray();
  return new Map(memberships.map((membership) => [String(membership.userId), membership]));
}

function buildPlan({ entries, dropRows, dropNames, unmatched, coverage, activeCount, dropsSkipped }) {
  const count = (action) => entries.filter((entry) => entry.action === action).length;
  return {
    add: count('add'),
    restore: count('restore'),
    previouslyRemoved: entries.filter((entry) => entry.previouslyRemoved).length,
    keep: count('keep'),
    drop: dropRows.map((row) => ({
      userId: String(row.userId),
      name: dropNames.get(String(row.userId)) || 'Unknown student',
    })),
    unmatched,
    activeCount,
    coverage,
    dropsSkipped,
  };
}

/**
 * Reconcile one GRASP section's enrollments with its LMS roster.
 *
 * @param {Object} params
 * @param {string|ObjectId} params.courseId
 * @param {Object} params.section - The grasp_course_section document (with lmsLink)
 * @param {string} params.provider - lmsLink provider, e.g. 'canvas'
 * @param {string|null} params.instance - Normalized LMS origin (src/lms/instance.js)
 * @param {Array<{ externalUserId: string, integrationId?: string, sisUserId?: string,
 *   loginId?: string, name: string, sortableName?: string }>} params.roster
 * @param {{ total: number, integrationId: number }} [params.coverage]
 * @param {string|ObjectId} params.actorUserId - The instructor running the sync
 * @param {string[]} [params.confirmDropUserIds] - The drop list the instructor agreed to
 * @param {boolean} [params.skipDrops] - Apply adds/restores only
 * @param {Date} [params.now]
 * @returns {Promise<{ status: 'confirmation-required', reason: string, plan: Object }
 *   | { status: 'applied', summary: Object }>}
 * @throws {LmsRosterError} no-integration-ids when a non-empty roster carries no integration_id
 */
async function syncSectionRoster({
  courseId,
  section,
  provider,
  instance,
  roster,
  coverage,
  actorUserId,
  confirmDropUserIds,
  skipDrops = false,
  now = new Date(),
}) {
  const rows = Array.isArray(roster) ? roster : [];
  const total = Number.isFinite(coverage?.total) ? coverage.total : rows.length;
  const withIntegrationId = Number.isFinite(coverage?.integrationId)
    ? coverage.integrationId
    : rows.filter((row) => typeof row.integrationId === 'string' && row.integrationId.trim()).length;
  const coverageRatio = total > 0 ? withIntegrationId / total : null;

  if (total > 0 && withIntegrationId === 0) {
    throw new LmsRosterError(
      ROSTER_ERROR_CODES.NO_INTEGRATION_IDS,
      'The LMS returned this section\'s students without their integration IDs, so none of them could be matched.'
    );
  }

  const db = await databaseService.connect();
  const courseObjectId = toObjectId(String(courseId));
  const sectionId = String(section.sectionId);
  const link = section.lmsLink || {};

  const { matched, unmatched } = await resolveRoster(db, rows);

  // Every row of this section, active and dropped.
  const sectionRows = await db.collection('grasp_user_course_section')
    .find({ courseId: courseObjectId, sectionId })
    .toArray();
  const rowByUser = new Map(sectionRows.map((row) => [String(row.userId), row]));
  const activeCount = sectionRows.filter(isActiveRow).length;

  const matchedUserIds = new Set(matched.filter((entry) => entry.user).map((entry) => String(entry.user._id)));
  const dropCandidates = sectionRows.filter(
    (row) => isActiveRow(row) && !matchedUserIds.has(String(row.userId))
  );

  // Rows this sync's roster dropped earlier whose student is still off the
  // roster. If the course-membership step failed after such a drop, the
  // cleanup sweep below finishes it (the row is no longer a drop candidate).
  const previouslyDroppedRows = sectionRows.filter(
    (row) =>
      !isActiveRow(row) &&
      row.droppedReason === DROPPED_REASONS.LMS_ROSTER &&
      !matchedUserIds.has(String(row.userId))
  );

  const memberships = await loadMemberships(db, courseId, [
    ...matched.filter((entry) => entry.user).map((entry) => entry.user._id),
    ...dropCandidates.map((row) => row.userId),
    ...previouslyDroppedRows.map((row) => row.userId),
  ]);

  // Only a membership the roster sync itself created (and not a TA's) can be
  // removed by a drop; the course owner is checked once it is loaded.
  const isRemovableMembership = (membership) =>
    Boolean(membership) &&
    membership.source === MEMBERSHIP_SOURCES.ROSTER_SYNC &&
    membership.courseRole !== TA_COURSE_ROLE;
  const cleanupRows = previouslyDroppedRows.filter((row) =>
    isRemovableMembership(memberships.get(String(row.userId)))
  );

  const entries = matched.map((entry) => {
    const existingRow = entry.user ? rowByUser.get(String(entry.user._id)) : null;
    if (!existingRow) return { ...entry, action: 'add', previouslyRemoved: false };
    if (!isActiveRow(existingRow)) {
      return {
        ...entry,
        action: 'restore',
        previouslyRemoved: existingRow.droppedReason === DROPPED_REASONS.REMOVED_FROM_COURSE,
      };
    }
    // An active row without a course membership is a student removed from
    // the course before removal also dropped their section rows. The roster
    // is authoritative, so they are restored like any removed student.
    if (!memberships.has(String(entry.user._id))) {
      return { ...entry, action: 'restore', previouslyRemoved: true };
    }
    return { ...entry, action: 'keep', previouslyRemoved: false };
  });

  const namedRows = [...dropCandidates, ...cleanupRows];
  const dropCandidateUsers = namedRows.length > 0
    ? await db.collection('grasp_user')
      .find(
        { _id: { $in: namedRows.map((row) => row.userId) } },
        { projection: { _id: 1, displayName: 1, legalName: 1, email: 1 } }
      )
      .toArray()
    : [];
  const dropNames = new Map(dropCandidateUsers.map((user) => [String(user._id), nameOf(user)]));

  let dropsSkipped = null;
  if (coverageRatio !== null && coverageRatio < MIN_INTEGRATION_ID_COVERAGE) {
    dropsSkipped = DROPS_SKIPPED.LOW_COVERAGE;
  } else if (skipDrops) {
    dropsSkipped = DROPS_SKIPPED.INSTRUCTOR_SKIPPED;
  }

  const considerDrops = dropCandidates.length > 0 && !dropsSkipped;
  if (considerDrops) {
    const isFirstSync = !link.dropsReviewedAt;
    const isLargeDrop = dropCandidates.length > LARGE_DROP_RATIO * activeCount;
    const confirmed = Array.isArray(confirmDropUserIds)
      ? new Set(confirmDropUserIds.map(String))
      : null;

    let reason = null;
    if (confirmed) {
      // Only ever drop people the instructor saw on the list. Anyone new
      // means the roster moved since the preview: ask again, and say so —
      // the first-sync / large-drop wording would read like the same prompt
      // reappearing.
      if (dropCandidates.some((row) => !confirmed.has(String(row.userId)))) {
        reason = CONFIRMATION_REASONS.ROSTER_CHANGED;
      }
    } else if (isFirstSync) {
      reason = CONFIRMATION_REASONS.FIRST_SYNC;
    } else if (isLargeDrop) {
      reason = CONFIRMATION_REASONS.LARGE_DROP;
    }

    if (reason) {
      return {
        status: SYNC_STATUS.CONFIRMATION_REQUIRED,
        reason,
        plan: buildPlan({
          entries,
          dropRows: dropCandidates,
          dropNames,
          unmatched,
          coverage: coverageRatio,
          activeCount,
          dropsSkipped,
        }),
      };
    }
  }
  const toDrop = considerDrops ? dropCandidates : [];

  const summary = {
    added: 0,
    restored: 0,
    previouslyRemovedRestored: 0,
    dropped: 0,
    kept: 0,
    unmatched,
    dropsSkipped,
    coverage: coverageRatio,
    errors: [],
  };

  for (const entry of entries) {
    let user = entry.user;
    try {
      let isMember = user ? memberships.has(String(user._id)) : false;
      if (!user) {
        // Re-read right before creating: createOrUpdateUser upserts, and must
        // never rewrite a real account that signed in since the lookup.
        user = await getUserByPuid(entry.integrationId);
        if (!user) {
          await createOrUpdateUser({
            puid: entry.integrationId,
            displayName: entry.row.name || undefined,
            affiliation: ['student'],
          });
          user = await getUserByPuid(entry.integrationId);
          if (!user) throw new Error('Placeholder user could not be created');
        }
        isMember = await isUserInCourse(user._id, courseObjectId);
      }

      if (!isMember) {
        await createUserCourse(user._id, courseObjectId, { source: MEMBERSHIP_SOURCES.ROSTER_SYNC });
      }
      await upsertUserCourseSection(user._id, courseObjectId, sectionId, { source: provider, now });
    } catch (error) {
      console.error(`[lms-roster-sync] ${entry.action} failed for one student:`, error);
      summary.errors.push({
        name: nameOf(entry.user, entry.row.name),
        action: entry.action,
      });
      continue;
    }

    // The enrollment is committed from here on: count and log it before the
    // LMS-account write, so a failure there can't hide a real add.
    if (entry.action === 'keep') {
      summary.kept += 1;
    } else {
      const restored = entry.action === 'restore';
      await recordCourseAccessEvent({
        courseId: courseObjectId,
        targetUserId: user._id,
        actorUserId,
        action: ACCESS_ACTIONS.SYNC_ADDED,
        role: 'student',
        details: {
          provider,
          sectionId,
          restored,
          previouslyRemoved: entry.previouslyRemoved,
        },
      });
      if (restored) {
        summary.restored += 1;
        if (entry.previouslyRemoved) summary.previouslyRemovedRestored += 1;
      } else {
        summary.added += 1;
      }
    }

    // Best-effort: every sync rewrites the LMS account of every matched
    // student, so a failure here heals on the next sync.
    if (instance && entry.row.externalUserId) {
      try {
        await upsertUserLmsAccount(user._id, {
          provider,
          instance,
          externalUserId: String(entry.row.externalUserId),
          sisUserId: entry.row.sisUserId,
          loginId: entry.row.loginId,
          name: entry.row.name,
          sortableName: entry.row.sortableName,
          updatedAt: now,
        });
      } catch (error) {
        console.error(
          `[lms-roster-sync] could not record the ${provider} account of user ${user._id}; the next sync retries:`,
          error
        );
      }
    }
  }

  let courseOwnerId = null;
  if (toDrop.length > 0 || (!dropsSkipped && cleanupRows.length > 0)) {
    const course = await db.collection('grasp_course').findOne(
      { _id: courseObjectId },
      { projection: { owner: 1 } }
    );
    courseOwnerId = course?.owner ? String(course.owner) : null;
  }

  // Losing the last active section also ends a course membership that the
  // roster sync itself created. Anything granted by a person — manual,
  // invite code, owner, a TA designation — stays. Returns whether it was
  // removed; throws if the membership could not be checked or removed.
  const removeMembershipIfLastSection = async (userId) => {
    const userKey = String(userId);
    const membership = memberships.get(userKey);
    if (!isRemovableMembership(membership) || userKey === courseOwnerId) return false;
    const remaining = await countActiveUserCourseSections(userId, courseObjectId);
    if (remaining !== 0) return false;
    await db.collection('grasp_user_course').deleteOne({ _id: membership._id });
    return true;
  };

  let dropErrors = 0;
  const reportDropError = (userId, error) => {
    dropErrors += 1;
    console.error('[lms-roster-sync] drop failed for one student:', error);
    summary.errors.push({
      name: dropNames.get(String(userId)) || 'Unknown student',
      action: 'drop',
    });
  };

  for (const row of toDrop) {
    let dropped;
    try {
      dropped = await dropUserCourseSection(row.userId, courseObjectId, sectionId, {
        reason: DROPPED_REASONS.LMS_ROSTER,
        droppedBy: actorUserId,
        now,
      });
    } catch (error) {
      reportDropError(row.userId, error);
      continue;
    }
    // Already dropped (or gone) since the rows were read: nothing changed.
    if (!dropped) continue;

    // The row is dropped from here on, so the drop is always logged. If the
    // membership step fails, the student is reported (not counted) and the
    // cleanup sweep of a later sync finishes it.
    let membershipRemoved = false;
    let membershipFailed = false;
    try {
      membershipRemoved = await removeMembershipIfLastSection(row.userId);
    } catch (error) {
      membershipFailed = true;
      reportDropError(row.userId, error);
    }

    await recordCourseAccessEvent({
      courseId: courseObjectId,
      targetUserId: row.userId,
      actorUserId,
      action: ACCESS_ACTIONS.SYNC_DROPPED,
      role: 'student',
      details: { provider, sectionId, membershipRemoved },
    });
    if (!membershipFailed) summary.dropped += 1;
  }

  // Cleanup sweep: a student this roster dropped earlier who is still off the
  // roster, and whose roster-sync membership outlived their last active
  // section because the membership step of that drop failed. Only when drops
  // are allowed on this sync, so the coverage and skip guards still hold.
  if (!dropsSkipped) {
    for (const row of cleanupRows) {
      try {
        if (!(await removeMembershipIfLastSection(row.userId))) continue;
        await recordCourseAccessEvent({
          courseId: courseObjectId,
          targetUserId: row.userId,
          actorUserId,
          action: ACCESS_ACTIONS.SYNC_DROPPED,
          role: 'student',
          details: { provider, sectionId, membershipRemoved: true },
        });
      } catch (error) {
        reportDropError(row.userId, error);
      }
    }
  }

  const lastSync = {
    at: now,
    by: toObjectId(String(actorUserId)),
    added: summary.added,
    restored: summary.restored,
    dropped: summary.dropped,
    kept: summary.kept,
    unmatched: unmatched.length,
    dropsSkipped,
    coverage: coverageRatio,
  };
  const linkUpdate = { 'lmsLink.lastSync': lastSync, updatedAt: now };
  if (!link.instance && instance) linkUpdate['lmsLink.instance'] = instance;
  // Drops have been reviewed once this sync either had nobody to drop or
  // dropped everyone it was allowed to. Skipped or failed drops leave the
  // next sync asking again.
  if (!dropsSkipped && dropErrors === 0) linkUpdate['lmsLink.dropsReviewedAt'] = now;

  await db.collection('grasp_course_section').updateOne(
    {
      courseId: courseObjectId,
      sectionId,
      // Never stamp a link that was replaced while this sync ran.
      'lmsLink.provider': provider,
      'lmsLink.externalSectionId': String(link.externalSectionId),
    },
    { $set: linkUpdate }
  );

  return { status: SYNC_STATUS.APPLIED, summary };
}

module.exports = {
  MIN_INTEGRATION_ID_COVERAGE,
  LARGE_DROP_RATIO,
  SYNC_STATUS,
  CONFIRMATION_REASONS,
  DROPS_SKIPPED,
  syncSectionRoster,
};
