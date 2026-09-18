const {
  getCourseUsers,
  createUserCourse,
  deleteUserCourse,
  isUserInCourse,
  getUserCourseMembership,
  setUserCourseRole,
  setUserCourseTaPermissions,
  countTaMemberships,
  MEMBERSHIP_SOURCES,
} = require('../services/user-course');
const {
  getStaffUsersNotInCourse,
  getStudentsNotInCourse,
  searchUsersNotInCourse,
  getUserById,
  grantPromotedStaffAffiliation,
  revokePromotedStaffAffiliation,
} = require('../services/user');
const {
  ACCESS_ACTIONS,
  recordCourseAccessEvent,
  getCourseAccessLog,
} = require('../services/course-access-log');
const { getSectionsOwnedByUser } = require('../services/course-section');
const { isFaculty } = require('../utils/auth');
const { TA_COURSE_ROLE, hasStaffAccessInCourse, resolveCourseRole } = require('../utils/course-access');
const { isCourseManager } = require('../utils/co-instructor-permissions');
const {
  TA_PERMISSION_KEYS,
  getEffectiveTaPermissions,
  sanitizeTaPermissions,
  assertTaPermission,
} = require('../utils/ta-permissions');

// Roles an instructor may grant when adding someone by hand (issue #115).
// 'member' is a plain membership: the person's effective course role then
// follows from their affiliation (student, or staff for SAML staff).
const ADD_ROLES = { MEMBER: 'member', TA: 'ta' };
const ADD_ROLE_VALUES = Object.values(ADD_ROLES);

// A search needs enough of an email or name to point at one person.
const SEARCH_MIN_LENGTH = 3;
const SEARCH_RESULT_LIMIT = 10;
const ACCESS_LOG_DEFAULT_LIMIT = 100;

const requesterIdOf = (req) => req.user._id || req.user.id;

/**
 * The role a user holds in a course with no TA designation: what they fall
 * back to when a TA role is removed, and what a plain "add" grants.
 * @returns {'staff'|'student'}
 */
function baseCourseRole(user) {
  return resolveCourseRole(user, null, false);
}

/**
 * Designate a course member as TA: the membership gains courseRole 'ta', a
 * clean (full-access) permission map, and the user gains the staff affiliation
 * when they did not already hold it from SAML. Shared by promotion and by
 * adding someone straight in as a TA.
 */
async function applyTaPromotion(userId, courseId, actorId) {
  await setUserCourseRole(userId, courseId, TA_COURSE_ROLE, { changedBy: actorId });
  // Fresh promotions start with full access (every permission enabled);
  // the instructor can restrict individual capabilities afterwards.
  await setUserCourseTaPermissions(userId, courseId, null);
  await grantPromotedStaffAffiliation(userId);
}

/**
 * Take the TA designation away. The staff affiliation granted by a promotion
 * is only revoked once the user holds no TA role in any course; SAML-granted
 * staff affiliations are never touched (they carry no promotion marker).
 * When the membership itself has just been deleted there is no role left to
 * clear, only the affiliation to reconsider.
 * @returns {Promise<Object|null>} The target user document
 */
async function applyTaDemotion(userId, courseId, actorId, { membershipRemoved = false } = {}) {
  if (!membershipRemoved) {
    await setUserCourseRole(userId, courseId, null, { changedBy: actorId });
    // A later re-promotion starts from a clean (full-access) slate.
    await setUserCourseTaPermissions(userId, courseId, null);
  }

  const remainingTaCourses = await countTaMemberships(userId);
  const targetUser = await getUserById(userId);
  if (remainingTaCourses === 0 && targetUser?.staffViaTaPromotion) {
    await revokePromotedStaffAffiliation(userId);
  }
  return targetUser;
}

/**
 * Shared guard for TA promotion/demotion: the requester must be faculty (an
 * instructor or app administrator) and a member of the course, and may not
 * target themselves. The /api/users mount is additionally faculty-gated in
 * server.js; this re-check keeps the handlers safe on their own.
 * Returns the target's membership doc, or null after sending the error.
 */
async function assertCanManageCourseRoles(req, res, courseId, targetUserId) {
  if (!(await isFaculty(req.user))) {
    res.status(403).json({
      success: false,
      error: "Only instructors can change course roles",
    });
    return null;
  }

  const requesterId = requesterIdOf(req);
  if (!(await isUserInCourse(requesterId, courseId))) {
    res.status(403).json({ success: false, error: "User is not in course" });
    return null;
  }

  if (!targetUserId) {
    res.status(400).json({ success: false, error: "userId is required" });
    return null;
  }

  if (String(requesterId) === String(targetUserId)) {
    res.status(400).json({
      success: false,
      error: "You cannot change your own course role",
    });
    return null;
  }

  const membership = await getUserCourseMembership(targetUserId, courseId);
  if (!membership) {
    res.status(404).json({ success: false, error: "User is not in this course" });
    return null;
  }

  return membership;
}

/**
 * POST /api/users/course/:courseId/promote
 * Designate a course member as TA: the membership gains courseRole 'ta' and
 * the user gains the staff affiliation (keeping student) unless SAML already
 * gave them one. Takes effect on the member's next login. Instructors cannot
 * be made TAs — they already outrank one, and touching their affiliations
 * could not be undone safely. Anyone else may hold the role, including staff
 * whose Workday affiliation is not a reliable signal of TA work.
 */
const promoteUserToTaHandler = async (req, res) => {
  try {
    const { courseId } = req.params;
    const { userId } = req.body || {};

    const membership = await assertCanManageCourseRoles(req, res, courseId, userId);
    if (!membership) return;

    if (membership.courseRole === TA_COURSE_ROLE) {
      return res.status(409).json({
        success: false,
        error: "User is already a TA in this course",
      });
    }

    const targetUser = await getUserById(userId);
    if (!targetUser) {
      return res.status(404).json({ success: false, error: "User not found" });
    }

    if (await isFaculty(targetUser)) {
      return res.status(400).json({
        success: false,
        error: "Instructors cannot be made TAs",
      });
    }

    const actorId = requesterIdOf(req);
    await applyTaPromotion(userId, courseId, actorId);
    await recordCourseAccessEvent({
      courseId,
      targetUserId: userId,
      actorUserId: actorId,
      action: ACCESS_ACTIONS.PROMOTED,
      role: TA_COURSE_ROLE,
    });

    res.json({
      success: true,
      message: "User promoted to TA. The change applies on their next login.",
    });
  } catch (error) {
    console.error("Error promoting user to TA:", error);
    res.status(500).json({ success: false, error: "Failed to promote user to TA" });
  }
};

/**
 * POST /api/users/course/:courseId/demote
 * Remove the TA designation in this course. A promoted student returns to
 * being a student; SAML staff return to ordinary course staff. The staff
 * affiliation granted by promotion is only revoked once the user holds no TA
 * role in any course; SAML-granted staff affiliations are never touched.
 */
const demoteTaToStudentHandler = async (req, res) => {
  try {
    const { courseId } = req.params;
    const { userId } = req.body || {};

    const membership = await assertCanManageCourseRoles(req, res, courseId, userId);
    if (!membership) return;

    if (membership.courseRole !== TA_COURSE_ROLE) {
      return res.status(400).json({
        success: false,
        error: "User is not a TA in this course",
      });
    }

    const actorId = requesterIdOf(req);
    const targetUser = await applyTaDemotion(userId, courseId, actorId);
    const revertedTo = targetUser ? baseCourseRole(targetUser) : 'student';
    await recordCourseAccessEvent({
      courseId,
      targetUserId: userId,
      actorUserId: actorId,
      action: ACCESS_ACTIONS.DEMOTED,
      role: revertedTo,
    });

    res.json({
      success: true,
      message:
        revertedTo === 'staff'
          ? "TA role removed. They remain course staff; the change applies on their next login."
          : "TA demoted to student. The change applies on their next login.",
      role: revertedTo,
    });
  } catch (error) {
    console.error("Error demoting TA to student:", error);
    res.status(500).json({ success: false, error: "Failed to demote TA" });
  }
};

/**
 * PUT /api/users/course/:courseId/ta-permissions
 * Replace a TA's per-course permission map. Instructor-only (same guard as
 * promotion/demotion); the target must currently be a TA in this course.
 * Takes effect immediately — permissions are read from the membership on
 * every request, not snapshotted into the session.
 */
const updateTaPermissionsHandler = async (req, res) => {
  try {
    const { courseId } = req.params;
    const { userId, permissions } = req.body || {};

    const membership = await assertCanManageCourseRoles(req, res, courseId, userId);
    if (!membership) return;

    if (membership.courseRole !== TA_COURSE_ROLE) {
      return res.status(400).json({
        success: false,
        error: "User is not a TA in this course",
      });
    }

    const sanitized = sanitizeTaPermissions(permissions);
    if (!sanitized) {
      return res.status(400).json({
        success: false,
        error: "permissions must be an object of known permission keys with boolean values",
      });
    }

    await setUserCourseTaPermissions(userId, courseId, sanitized);
    await recordCourseAccessEvent({
      courseId,
      targetUserId: userId,
      actorUserId: requesterIdOf(req),
      action: ACCESS_ACTIONS.PERMISSIONS_UPDATED,
      role: TA_COURSE_ROLE,
      details: { permissions: sanitized },
    });

    res.json({
      success: true,
      message: "TA permissions updated",
      permissions: getEffectiveTaPermissions(sanitized),
    });
  } catch (error) {
    console.error("Error updating TA permissions:", error);
    res.status(500).json({ success: false, error: "Failed to update TA permissions" });
  }
};

/**
 * Resolve the authenticated user's effective role in one course. Promoted TAs
 * are staff only where their membership carries courseRole "ta"; in their
 * other courses they remain students.
 */
const getCourseAccessHandler = async (req, res) => {
  try {
    const { courseId } = req.params;
    const userId = req.user?._id || req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: "User not authenticated" });
    }

    const membership = await getUserCourseMembership(userId, courseId);
    if (!membership) {
      return res.status(403).json({ success: false, error: "User is not in course" });
    }

    const userIsFaculty = await isFaculty(req.user);
    const hasStaffAccess = await hasStaffAccessInCourse(req.user, courseId);
    const role = hasStaffAccess
      ? resolveCourseRole(req.user, membership, userIsFaculty)
      : "student";

    // TAs get their configured capability map; everyone else with staff
    // access is unrestricted by this layer, so their map is all-true.
    const taPermissions = getEffectiveTaPermissions(
      role === "ta" ? membership.taPermissions : null
    );

    return res.json({ success: true, hasStaffAccess, role, taPermissions });
  } catch (error) {
    console.error("Error resolving course access:", error);
    return res.status(500).json({ success: false, error: "Failed to resolve course access" });
  }
};

const getCourseUsersHandler = async (req, res) => {
  try {
    const { courseId } = req.params;
    const userId = req.user._id || req.user.id;

    if (!userId) {
      console.error("User not authenticated - req.user:", req.user);
      return res.status(401).json({ 
        success: false,
        error: "User not authenticated" 
      });
    }

    console.log("Checking if user is in course:", { userId, courseId, userIdType: typeof userId, courseIdType: typeof courseId });

    if (!(await isUserInCourse(userId, courseId))) {
      return res.status(403).json({
        success: false,
        error: "User is not in course"
      });
    }

    // This page is available to faculty, genuine staff, and promoted TAs in
    // this course. A promoted TA must not inherit access in another course.
    if (!(await hasStaffAccessInCourse(req.user, courseId))) {
      return res.status(403).json({
        success: false,
        error: "Staff access is not granted in this course"
      });
    }
    if (!(await assertTaPermission(req, res, courseId, TA_PERMISSION_KEYS.USERS))) return;

    console.log("Fetching course users for courseId:", courseId);
    const courseUsers = await getCourseUsers(courseId);
    console.log("Found", courseUsers.length, "users in course");

    // Scope student visibility by section ownership: every instructor — the
    // course owner included — only sees students enrolled in a section they own.
    // Faculty/staff (course-level members, not bound to a section) stay visible
    // to all instructors.
    const ownedSections = await getSectionsOwnedByUser(courseId, req.user._id || req.user.id);
    const ownedSectionIds = new Set(ownedSections.map((s) => s.sectionId));

    const users = [];
    for (const courseUser of courseUsers) {
      const userDoc = courseUser.user || courseUser;
      const userIsFaculty = await isFaculty(userDoc);
      const courseRole = resolveCourseRole(userDoc, courseUser, userIsFaculty);

      // Instructors, TAs, and genuine staff are course-level members and
      // visible to every instructor. TA rows carry their effective permission
      // map so the Users page can prefill the permissions editor, plus the
      // role they revert to if the designation is removed.
      if (courseRole !== "student") {
        const row = { ...courseUser, courseRole };
        if (courseRole === "ta") {
          row.taPermissions = getEffectiveTaPermissions(courseUser.taPermissions);
          row.baseRole = baseCourseRole(userDoc);
        }
        users.push(row);
        continue;
      }

      // Manually added students were let in by an instructor, not by a section
      // roster, so they have no section to be scoped by: every instructor sees
      // them, the same as the course-level members above. Otherwise a guest
      // added by one co-instructor would be invisible — and unrevokable — to
      // the others.
      if (courseUser.source === MEMBERSHIP_SOURCES.MANUAL) {
        users.push({ ...courseUser, courseRole });
        continue;
      }

      // Only surface the student in (and limited to) the sections this instructor owns.
      const studentOwnedSections = (courseUser.sections || []).filter((id) =>
        ownedSectionIds.has(id)
      );
      if (studentOwnedSections.length > 0) {
        users.push({ ...courseUser, sections: studentOwnedSections, courseRole });
      }
    }

    res.json({
      success: true,
      users,
    });
  } catch (error) {
    console.error("Error fetching course users:", error);
    console.error("Error stack:", error.stack);
    res.status(500).json({ 
      success: false,
      error: "Failed to fetch course users",
      details: error.message 
    });
  }
};

const getStaffUsersNotInCourseHandler = async (req, res) => {
  try {
    const { courseId } = req.params;

    // Only faculty can view available staff
    if (!(await isFaculty(req.user))) {
      return res.status(403).json({ 
        success: false,
        error: "Only faculty can view available staff" 
      });
    }

    // Check if user is in course
    if (!(await isUserInCourse(req.user.id || req.user._id, courseId))) {
      return res.status(403).json({ 
        success: false,
        error: "User is not in course" 
      });
    }

    const staffUsers = await getStaffUsersNotInCourse(courseId);

    res.json({
      success: true,
      users: staffUsers,
    });
  } catch (error) {
    console.error("Error fetching staff users not in course:", error);
    res.status(500).json({ 
      success: false,
      error: "Failed to fetch staff users" 
    });
  }
};

const getStudentsNotInCourseHandler = async (req, res) => {
  try {
    const { courseId } = req.params;

    // Only faculty can view available students
    if (!(await isFaculty(req.user))) {
      return res.status(403).json({ 
        success: false,
        error: "Only faculty can view available students" 
      });
    }

    // Check if user is in course
    if (!(await isUserInCourse(req.user.id || req.user._id, courseId))) {
      return res.status(403).json({ 
        success: false,
        error: "User is not in course" 
      });
    }

    const students = await getStudentsNotInCourse(courseId);

    res.json({
      success: true,
      users: students,
    });
  } catch (error) {
    console.error("Error fetching students not in course:", error);
    res.status(500).json({ 
      success: false,
      error: "Failed to fetch students" 
    });
  }
};

const getAllUsersNotInCourseHandler = async (req, res) => {
  try {
    const { courseId } = req.params;

    // Only faculty can view available users
    if (!(await isFaculty(req.user))) {
      return res.status(403).json({ 
        success: false,
        error: "Only faculty can view available users" 
      });
    }

    // Check if user is in course
    if (!(await isUserInCourse(req.user.id || req.user._id, courseId))) {
      return res.status(403).json({ 
        success: false,
        error: "User is not in course" 
      });
    }

    // Get both staff and students not in course
    const [staffUsers, studentUsers] = await Promise.all([
      getStaffUsersNotInCourse(courseId),
      getStudentsNotInCourse(courseId)
    ]);

    // Combine and add role info
    const allUsers = [
      ...staffUsers.map(u => ({ ...u, role: 'staff' })),
      ...studentUsers.map(u => ({ ...u, role: 'student' }))
    ];

    // Sort alphabetically by displayName
    allUsers.sort((a, b) => {
      const nameA = (a.displayName || '').toLowerCase();
      const nameB = (b.displayName || '').toLowerCase();
      return nameA.localeCompare(nameB);
    });

    res.json({
      success: true,
      users: allUsers,
    });
  } catch (error) {
    console.error("Error fetching all users not in course:", error);
    res.status(500).json({ 
      success: false,
      error: "Failed to fetch users" 
    });
  }
};

/**
 * GET /api/users/search/not-in-course/:courseId?q=
 * Find accounts to add by hand (issue #115). Search-only: the instructor
 * types an email or name and gets at most a handful of non-member matches —
 * never a browsable list of every GRASP account. Instructor accounts are
 * left out; they join a course with its invite code, as before.
 */
const searchUsersNotInCourseHandler = async (req, res) => {
  try {
    const { courseId } = req.params;
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';

    if (!(await isFaculty(req.user))) {
      return res.status(403).json({
        success: false,
        error: "Only faculty can search for users to add",
      });
    }

    if (!(await isUserInCourse(requesterIdOf(req), courseId))) {
      return res.status(403).json({ success: false, error: "User is not in course" });
    }

    if (query.length < SEARCH_MIN_LENGTH) {
      return res.status(400).json({
        success: false,
        error: `Enter at least ${SEARCH_MIN_LENGTH} characters of an email or name`,
      });
    }

    const matches = await searchUsersNotInCourse(courseId, query, { limit: SEARCH_RESULT_LIMIT });
    const users = [];
    for (const user of matches) {
      if (await isFaculty(user)) continue;
      users.push({
        _id: user._id,
        email: user.email,
        displayName: user.displayName,
        legalName: user.legalName,
        affiliation: user.affiliation,
        role: baseCourseRole(user),
        courseCount: user.courseCount || 0,
      });
    }

    res.json({ success: true, users });
  } catch (error) {
    console.error("Error searching users not in course:", error);
    res.status(500).json({ success: false, error: "Failed to search users" });
  }
};

/**
 * POST /api/users/course/:courseId/add
 * Grant course access to an account by hand. Body: { userId, role } where
 * role is 'member' (default — effective role follows their affiliation) or
 * 'ta'. The membership records who granted it and when, and the grant is
 * appended to the course access log (issue #115).
 */
const addUserToCourseHandler = async (req, res) => {
  try {
    const { courseId } = req.params;
    const { userId, role = ADD_ROLES.MEMBER } = req.body || {};

    // Only faculty can add users to courses
    if (!(await isFaculty(req.user))) {
      return res.status(403).json({ 
        success: false,
        error: "Only faculty can add users to courses" 
      });
    }

    // Check if current user is in course
    const actorId = requesterIdOf(req);
    if (!(await isUserInCourse(actorId, courseId))) {
      return res.status(403).json({
        success: false,
        error: "User is not in course"
      });
    }

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: "userId is required"
      });
    }

    if (!ADD_ROLE_VALUES.includes(role)) {
      return res.status(400).json({
        success: false,
        error: `role must be one of: ${ADD_ROLE_VALUES.join(', ')}`,
      });
    }

    // Check if user is already in course
    if (await isUserInCourse(userId, courseId)) {
      return res.status(409).json({ 
        success: false,
        error: "User is already in this course" 
      });
    }

    const targetUser = await getUserById(userId);
    if (!targetUser) {
      return res.status(404).json({ success: false, error: "User not found" });
    }

    // Instructors are course-level peers, not guests: they join with the
    // course invite code, and only the owner can remove them again.
    if (await isFaculty(targetUser)) {
      return res.status(400).json({
        success: false,
        error: "Instructors join a course with its invite code",
      });
    }

    await createUserCourse(userId, courseId, {
      source: MEMBERSHIP_SOURCES.MANUAL,
      addedBy: actorId,
    });

    const asTa = role === ADD_ROLES.TA;
    if (asTa) {
      await applyTaPromotion(userId, courseId, actorId);
    }

    const grantedRole = asTa ? TA_COURSE_ROLE : baseCourseRole(targetUser);
    await recordCourseAccessEvent({
      courseId,
      targetUserId: userId,
      actorUserId: actorId,
      action: ACCESS_ACTIONS.ADDED,
      role: grantedRole,
    });

    res.json({
      success: true,
      message: asTa
        ? "User added to the course as a TA. TA access applies on their next login."
        : "User added to course successfully",
      role: grantedRole,
    });
  } catch (error) {
    console.error("Error adding user to course:", error);
    res.status(500).json({ 
      success: false,
      error: "Failed to add user to course" 
    });
  }
};

const removeUserFromCourseHandler = async (req, res) => {
  try {
    const { courseId, userId } = req.params;

    // Only faculty can remove users from courses
    if (!(await isFaculty(req.user))) {
      return res.status(403).json({ 
        success: false,
        error: "Only faculty can remove users from courses" 
      });
    }

    // Check if current user is in course
    if (!(await isUserInCourse(req.user.id || req.user._id, courseId))) {
      return res.status(403).json({
        success: false,
        error: "User is not in course"
      });
    }

    // Prevent removing yourself from the course
    const currentUserId = String(req.user.id || req.user._id);
    const targetUserId = String(userId);
    if (currentUserId === targetUserId) {
      return res.status(400).json({ 
        success: false,
        error: "Cannot remove yourself from the course" 
      });
    }

    // Check if user is in course
    if (!(await isUserInCourse(userId, courseId))) {
      return res.status(404).json({
        success: false,
        error: "User is not in this course"
      });
    }

    // Only the course owner (or an app administrator) may remove another
    // instructor; co-instructors can only remove non-instructor users.
    const targetUser = await getUserById(userId);
    const targetIsFaculty = targetUser ? await isFaculty(targetUser) : false;
    if (targetIsFaculty && !(await isCourseManager(req.user, courseId))) {
      return res.status(403).json({
        success: false,
        error: "Only the course owner can remove other instructors"
      });
    }

    // Read the membership before it goes: the audit entry records the role
    // being revoked, and a TA's promoted affiliation has to be reconsidered.
    const membership = await getUserCourseMembership(userId, courseId);
    const heldRole = targetUser
      ? resolveCourseRole(targetUser, membership, targetIsFaculty)
      : null;

    // Remove user from course
    const result = await deleteUserCourse(userId, courseId);

    // Removing a TA is a revocation too: without this, the staff affiliation
    // granted by their promotion would outlive the course it was granted for.
    if (membership?.courseRole === TA_COURSE_ROLE) {
      await applyTaDemotion(userId, courseId, currentUserId, { membershipRemoved: true });
    }

    await recordCourseAccessEvent({
      courseId,
      targetUserId: userId,
      actorUserId: currentUserId,
      action: ACCESS_ACTIONS.REMOVED,
      role: heldRole,
    });

    res.json({
      success: true,
      message: "User removed from course successfully",
      deletedCount: result.deletedCount,
    });
  } catch (error) {
    console.error("Error removing user from course:", error);
    res.status(500).json({ 
      success: false,
      error: "Failed to remove user from course" 
    });
  }
};

/**
 * GET /api/users/course/:courseId/access-log?limit=
 * Newest-first record of who granted, changed, or revoked access in this
 * course. Instructors only — it is the evidence behind every manual grant.
 */
const getCourseAccessLogHandler = async (req, res) => {
  try {
    const { courseId } = req.params;

    if (!(await isFaculty(req.user))) {
      return res.status(403).json({
        success: false,
        error: "Only instructors can view the access history",
      });
    }

    if (!(await isUserInCourse(requesterIdOf(req), courseId))) {
      return res.status(403).json({ success: false, error: "User is not in course" });
    }

    const requested = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(requested) && requested > 0
      ? requested
      : ACCESS_LOG_DEFAULT_LIMIT;

    const events = await getCourseAccessLog(courseId, { limit });
    res.json({ success: true, events });
  } catch (error) {
    console.error("Error fetching course access log:", error);
    res.status(500).json({ success: false, error: "Failed to fetch access history" });
  }
};

module.exports = {
  ADD_ROLES,
  getCourseAccessHandler,
  getCourseUsersHandler,
  getStaffUsersNotInCourseHandler,
  getStudentsNotInCourseHandler,
  getAllUsersNotInCourseHandler,
  searchUsersNotInCourseHandler,
  addUserToCourseHandler,
  removeUserFromCourseHandler,
  promoteUserToTaHandler,
  demoteTaToStudentHandler,
  updateTaPermissionsHandler,
  getCourseAccessLogHandler,
};
