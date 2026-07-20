const { getCourseUsers, createUserCourse, deleteUserCourse, isUserInCourse, getUserCourseMembership, setUserCourseRole, setUserCourseTaPermissions, countTaMemberships } = require('../services/user-course');
const { getStaffUsersNotInCourse, getStudentsNotInCourse, getUserById, grantPromotedStaffAffiliation, revokePromotedStaffAffiliation } = require('../services/user');
const { getSectionsOwnedByUser } = require('../services/course-section');
const { isFaculty, parseAffiliations } = require('../utils/auth');
const { TA_COURSE_ROLE, hasStaffAccessInCourse, resolveCourseRole } = require('../utils/course-access');
const { isCourseManager } = require('../utils/co-instructor-permissions');
const {
  TA_PERMISSION_KEYS,
  getEffectiveTaPermissions,
  sanitizeTaPermissions,
  assertTaPermission,
} = require('../utils/ta-permissions');

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

  const requesterId = req.user._id || req.user.id;
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
 * Promote a student in the course to TA: the membership gains
 * courseRole 'ta' and the user gains the staff affiliation (keeping
 * student). Takes effect on the student's next login.
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

    // Only regular students are promotable. Faculty and genuine SAML staff
    // already outrank TAs, and touching their affiliations could not be
    // undone safely.
    const affiliations = parseAffiliations(targetUser);
    if (affiliations.includes("faculty") ||
        (affiliations.includes("staff") && !targetUser.staffViaTaPromotion)) {
      return res.status(400).json({
        success: false,
        error: "Only students can be promoted to TA",
      });
    }
    if (!affiliations.includes("student") && !affiliations.includes("affiliate")) {
      return res.status(400).json({
        success: false,
        error: "Only students can be promoted to TA",
      });
    }

    await setUserCourseRole(userId, courseId, TA_COURSE_ROLE);
    // Fresh promotions start with full access (every permission enabled);
    // the instructor can restrict individual capabilities afterwards.
    await setUserCourseTaPermissions(userId, courseId, null);
    await grantPromotedStaffAffiliation(userId);

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
 * Demote a TA back to student in this course. The staff affiliation granted
 * by promotion is only revoked once the user holds no TA role in any course;
 * SAML-granted staff affiliations are never touched.
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

    await setUserCourseRole(userId, courseId, null);
    // A later re-promotion starts from a clean (full-access) slate.
    await setUserCourseTaPermissions(userId, courseId, null);

    const remainingTaCourses = await countTaMemberships(userId);
    const targetUser = await getUserById(userId);
    if (remainingTaCourses === 0 && targetUser?.staffViaTaPromotion) {
      await revokePromotedStaffAffiliation(userId);
    }

    res.json({
      success: true,
      message: "TA demoted to student. The change applies on their next login.",
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
      const userIsFaculty = await isFaculty(courseUser.user || courseUser);
      const courseRole = resolveCourseRole(
        courseUser.user || courseUser,
        courseUser,
        userIsFaculty
      );

      // Instructors, TAs, and genuine staff are course-level members and
      // visible to every instructor. TA rows carry their effective permission
      // map so the Users page can prefill the permissions editor.
      if (courseRole !== "student") {
        const row = { ...courseUser, courseRole };
        if (courseRole === "ta") {
          row.taPermissions = getEffectiveTaPermissions(courseUser.taPermissions);
        }
        users.push(row);
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

const addUserToCourseHandler = async (req, res) => {
  try {
    const { courseId } = req.params;
    const { userId } = req.body;

    // Only faculty can add users to courses
    if (!(await isFaculty(req.user))) {
      return res.status(403).json({ 
        success: false,
        error: "Only faculty can add users to courses" 
      });
    }

    // Check if current user is in course
    if (!(await isUserInCourse(req.user.id || req.user._id, courseId))) {
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

    // Check if user is already in course
    if (await isUserInCourse(userId, courseId)) {
      return res.status(409).json({ 
        success: false,
        error: "User is already in this course" 
      });
    }

    // Add user to course
    await createUserCourse(userId, courseId);

    res.json({
      success: true,
      message: "User added to course successfully",
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
    if (targetUser && (await isFaculty(targetUser)) && !(await isCourseManager(req.user, courseId))) {
      return res.status(403).json({
        success: false,
        error: "Only the course owner can remove other instructors"
      });
    }

    // Remove user from course
    const result = await deleteUserCourse(userId, courseId);

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

module.exports = {
  getCourseAccessHandler,
  getCourseUsersHandler,
  getStaffUsersNotInCourseHandler,
  getStudentsNotInCourseHandler,
  getAllUsersNotInCourseHandler,
  addUserToCourseHandler,
  removeUserFromCourseHandler,
  promoteUserToTaHandler,
  demoteTaToStudentHandler,
  updateTaPermissionsHandler
};
