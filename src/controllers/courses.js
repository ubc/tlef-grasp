const crypto = require('crypto');
const {
  createCourse,
  getCourseById,
  getCourseByCode,
  findAvailableCourseCode,
  getCourseByEnrollmentCode,
  listCoursesForEnrollment,
  updateCourseEnrollmentCode,
} = require('../services/course');

const { createUserCourse, getUserCourses, isUserInCourse, getCourseUsers } = require('../services/user-course');
const { upsertCourseSection, getCourseSections, upsertUserCourseSection, getUserCourseSections, getSectionStudents, getSectionsByOwner, getSectionsForViewer } = require('../services/course-section');
const materialService = require('../services/material');
const questionService = require('../services/question');
const { isFaculty, isStudent } = require('../utils/auth');
const { createOrUpdateUser, getUserByPuid } = require('../services/user');
const ubcApiService = require('../services/ubcApiService');
const { buildCourseCode, campusDisplaySuffix } = require('../utils/slug');

const COURSE_ACCESS_CODE_LENGTH = 12;
const COURSE_ACCESS_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function generateCourseAccessCode(length = COURSE_ACCESS_CODE_LENGTH) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += COURSE_ACCESS_CHARS[bytes[i] % COURSE_ACCESS_CHARS.length];
  }
  return out;
}

function timingSafeEqualString(a, b) {
  const bufA = Buffer.from(String(a), 'utf8');
  const bufB = Buffer.from(String(b), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function omitCourseAccess(course) {
  if (!course) return course;
  const { courseAccess, ...rest } = course;
  return rest;
}

async function listCourseInstructors(courseId) {
  const members = await getCourseUsers(courseId);
  const instructors = [];
  for (const m of members) {
    if (await isFaculty(m.user)) {
      const name = m.displayName || m.user?.displayName;
      if (name) instructors.push(name);
    }
  }
  return instructors;
}

const getMyCourses = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const userCourses = await getUserCourses(userId);
    const courses = userCourses.map((c) => omitCourseAccess(c.course));
    res.json({ success: true, courses });
  } catch (error) {
    console.error("Error getting user courses:", error);
    res.status(500).json({ error: "Failed to retrieve courses" });
  }
};

const getCourseByIdHandler = async (req, res) => {
  try {
    const { courseId } = req.params;
    const course = await getCourseById(courseId);
    if (!course) return res.status(404).json({ error: "Course not found" });
    res.json({ success: true, course: omitCourseAccess(course) });
  } catch (error) {
    console.error("Error getting course:", error);
    res.status(500).json({ error: "Failed to retrieve course" });
  }
};

const getCourseMaterials = async (req, res) => {
  try {
    const { courseId } = req.params;
    const course = await getCourseById(courseId);
    if (!course) return res.status(404).json({ error: "Course not found" });
    const materials = await materialService.getCourseMaterials(courseId);
    res.json({ success: true, materials });
  } catch (error) {
    console.error("Error getting course materials:", error);
    res.status(500).json({ error: "Failed to retrieve course materials" });
  }
};

const getCourseQuestions = async (req, res) => {
  try {
    const { courseId } = req.params;
    const course = await getCourseById(courseId);
    if (!course) return res.status(404).json({ error: "Course not found" });
    const questions = await questionService.getQuestions(courseId);
    res.json({ success: true, questions });
  } catch (error) {
    console.error("Error getting course questions:", error);
    res.status(500).json({ error: "Failed to retrieve course questions" });
  }
};

const addCourseMaterial = async (req, res) => {
  try {
    const { courseId } = req.params;
    const { title, type, sourceId, fileContent, fileSize } = req.body;
    if (!title || !type) return res.status(400).json({ error: "Title and type are required" });

    const course = await getCourseById(courseId);
    if (!course) return res.status(404).json({ error: "Course not found" });

    const materialSourceId = sourceId || `m${Date.now()}`;
    await materialService.saveMaterial(materialSourceId, courseId, {
      fileType: type,
      fileSize: fileSize || 0,
      fileContent,
      documentTitle: title,
    });
    const newMaterial = await materialService.getMaterialBySourceId(materialSourceId);
    res.json({ success: true, message: "Material added successfully", material: newMaterial });
  } catch (error) {
    console.error("Error adding course material:", error);
    res.status(500).json({ error: "Failed to add course material" });
  }
};

/**
 * Re-fetch the chosen sections from UBC API so the server controls the
 * authoritative course title (instead of trusting whatever the client sent).
 * All selected sections must belong to the same UBC course.
 */
async function resolveSectionsToCourse(sectionIds) {
  const sections = await ubcApiService.getCourseSectionsByIds(sectionIds);
  if (!sections || sections.length === 0) {
    return { error: "Could not find the selected sections in UBC API" };
  }
  if (sections.length !== sectionIds.length) {
    return { error: "Some of the selected sections could not be found" };
  }

  const keys = [...new Set(sections.map((s) =>
    `${s.course?.courseSubject?.code || ''}|${s.course?.courseNumber || ''}`
  ))];
  if (keys.length !== 1 || keys[0] === '|') {
    return { error: "All selected sections must belong to the same UBC course" };
  }

  const ubcCourseId = keys[0];

  const first = sections[0];
  const courseTitle =
    first.course?.title ||
    first.course?.abbreviatedTitle ||
    first.abbreviatedTitle ||
    '';
  return { courseTitle, sections, ubcCourseId };
}

async function syncStudentsToCourse(courseId, sectionIds, academicPeriod) {
  try {
    const students = await ubcApiService.getStudentsWithSectionsByIds(sectionIds, academicPeriod);
    if (!students || students.length === 0) return { added: 0 };

    let added = 0;
    for (const s of students) {
      if (!s.puid) continue;
      try {
        let user = await getUserByPuid(s.puid);
        if (!user) {
          await createOrUpdateUser({
            puid: s.puid,
            displayName: s.displayName,
            email: s.email,
            affiliation: ['student'],
          });
          user = await getUserByPuid(s.puid);
        }
        if (!user) continue;

        if (!(await isUserInCourse(user._id, courseId))) {
          await createUserCourse(user._id, courseId);
          added += 1;
        }

        for (const sid of (s.sectionIds || [])) {
          await upsertUserCourseSection(user._id, courseId, sid);
        }
      } catch (perStudentError) {
        console.error("syncStudents: skipped one student:", perStudentError);
      }
    }
    return { added };
  } catch (error) {
    console.error("syncStudents failed:", error);
    return { added: 0, error: error.message };
  }
}

const createNewCourse = async (req, res) => {
  try {
    if (!(await isFaculty(req.user))) {
      return res.status(403).json({ error: "Only faculty can create new courses" });
    }

    const {
      campus,
      academicPeriod,
      academicPeriodName,
      sectionIds,
      syncStudents = false,
      force = false,
    } = req.body || {};

    if (!campus || !academicPeriod) {
      return res.status(400).json({ error: "Campus and academic period are required" });
    }
    if (!Array.isArray(sectionIds) || sectionIds.length === 0) {
      return res.status(400).json({ error: "Select at least one section" });
    }

    const resolved = await resolveSectionsToCourse(sectionIds);
    if (resolved.error) return res.status(400).json({ error: resolved.error });

    const { courseTitle, ubcCourseId } = resolved;
    if (!courseTitle) {
      return res.status(400).json({ error: "UBC API did not return a course title for the selected sections" });
    }

    const displaySuffix = campusDisplaySuffix(campus);
    const courseName = displaySuffix ? `${courseTitle} ${displaySuffix}` : courseTitle;

    const baseCode = buildCourseCode(courseTitle, campus);
    if (!baseCode) {
      return res.status(400).json({ error: "Could not derive a course code from the course name" });
    }

    let courseCode = baseCode;
    if (force) {
      courseCode = await findAvailableCourseCode(baseCode);
      if (!courseCode) {
        return res.status(500).json({ error: "Could not find an available course code" });
      }
    } else {
      const existing = await getCourseByCode(baseCode);
      if (existing) {
        return res.status(409).json({
          error: "existing_shell",
          message: "A course shell already exists for this title/campus.",
          existing,
        });
      }
    }

    const courseData = {
      courseName,
      courseCode,
      campus,
      courseAccess: generateCourseAccessCode(),
      owner: req.user?._id,
      ubcCourseId
    };
    const result = await createCourse(courseData);
    const courseId = result.insertedId;
    const userId = req.user?._id;

    if (userId) {
      try {
        await createUserCourse(userId, courseId);
      } catch (userCourseError) {
        console.error("Error creating user-course relationship:", userCourseError);
      }
    }

    for (const s of resolved.sections) {
      try {
        await upsertCourseSection(courseId, {
          sectionId: s.courseSectionId,
          sectionNumber: s.sectionNumber || '',
          academicPeriod,
          academicPeriodName,
          owner: userId,
        });
      } catch (sectionError) {
        console.error("Error saving course section:", sectionError);
      }
    }

    let syncResult = null;
    if (syncStudents) {
      syncResult = await syncStudentsToCourse(courseId, sectionIds, academicPeriod);
    }

    const newCourse = await getCourseById(courseId);
    res.status(201).json({
      success: true,
      message: "Course created successfully",
      course: omitCourseAccess(newCourse),
      ...(syncResult ? { studentsSynced: syncResult.added } : {}),
    });
  } catch (error) {
    console.error("Error creating course:", error);
    res.status(500).json({ error: "Failed to create course", details: error.message });
  }
};

const listEnrollmentCourses = async (req, res) => {
  try {
    if (!(await isStudent(req.user))) {
      return res.status(403).json({ error: "Only students can browse courses to join" });
    }
    const q = req.query.q || "";
    const courses = await listCoursesForEnrollment(q);
    res.json({
      success: true,
      courses: courses.map((c) => ({
        _id: c._id.toString(),
        courseName: c.courseName,
        courseCode: c.courseCode,
      })),
    });
  } catch (error) {
    console.error("Error listing enrollment courses:", error);
    res.status(500).json({ error: "Failed to list courses" });
  }
};

const joinCourseWithCode = async (req, res) => {
  try {
    if (!(await isStudent(req.user))) {
      return res.status(403).json({ error: "Only students can join a course with an enrollment code" });
    }

    const { courseId } = req.params;
    const enrollmentCode = req.body?.enrollmentCode ?? req.body?.code;
    if (!enrollmentCode || typeof enrollmentCode !== "string" || !enrollmentCode.trim()) {
      return res.status(400).json({ error: "Enrollment code is required" });
    }

    const course = await getCourseById(courseId);
    if (!course) return res.status(404).json({ error: "Course not found" });

    const userId = req.user._id || req.user.id;
    if (await isUserInCourse(userId, courseId)) {
      return res.status(409).json({ error: "You are already enrolled in this course" });
    }

    if (!course.courseAccess) {
      return res.status(503).json({
        error: "This course does not have an enrollment code yet. Ask your instructor to open Settings and generate one.",
      });
    }
    if (!timingSafeEqualString(enrollmentCode.trim(), course.courseAccess)) {
      return res.status(403).json({ error: "Invalid enrollment code" });
    }

    await createUserCourse(userId, course._id);
    res.json({
      success: true,
      message: "You have been added to the course",
      course: { _id: course._id.toString(), courseName: course.courseName, courseCode: course.courseCode },
    });
  } catch (error) {
    console.error("Error joining course:", error);
    res.status(500).json({ error: "Failed to join course" });
  }
};

const joinCourseByEnrollmentCode = async (req, res) => {
  try {
    if (!(await isStudent(req.user))) {
      return res.status(403).json({ error: "Only students can join a course with an enrollment code" });
    }
    const enrollmentCode = req.body?.enrollmentCode ?? req.body?.code;
    if (!enrollmentCode || typeof enrollmentCode !== "string" || !enrollmentCode.trim()) {
      return res.status(400).json({ error: "Enrollment code is required" });
    }

    const course = await getCourseByEnrollmentCode(enrollmentCode.trim());
    if (!course) return res.status(403).json({ error: "Invalid enrollment code" });

    const userId = req.user._id || req.user.id;
    if (await isUserInCourse(userId, course._id.toString())) {
      return res.status(409).json({ error: "You are already enrolled in this course" });
    }
    if (!course.courseAccess) {
      return res.status(503).json({
        error: "This course does not have an enrollment code yet. Ask your instructor to open Settings and generate one.",
      });
    }

    await createUserCourse(userId, course._id);
    res.json({
      success: true,
      message: "You have been added to the course",
      course: { _id: course._id.toString(), courseName: course.courseName, courseCode: course.courseCode },
    });
  } catch (error) {
    console.error("Error joining course by code:", error);
    res.status(500).json({ error: "Failed to join course" });
  }
};

const getEnrollmentCode = async (req, res) => {
  try {
    if (!(await isFaculty(req.user))) {
      return res.status(403).json({ error: "Only faculty can view enrollment codes" });
    }
    const { courseId } = req.params;
    const userId = req.user._id || req.user.id;
    if (!(await isUserInCourse(userId, courseId))) {
      return res.status(403).json({ error: "You must be a member of this course" });
    }

    let course = await getCourseById(courseId);
    if (!course) return res.status(404).json({ error: "Course not found" });

    if (!course.courseAccess) {
      const newCode = generateCourseAccessCode();
      await updateCourseEnrollmentCode(courseId, newCode);
      course = { ...course, courseAccess: newCode };
    }
    res.json({ success: true, enrollmentCode: course.courseAccess });
  } catch (error) {
    console.error("Error getting enrollment code:", error);
    res.status(500).json({ error: "Failed to load enrollment code" });
  }
};

const regenerateEnrollmentCode = async (req, res) => {
  try {
    if (!(await isFaculty(req.user))) {
      return res.status(403).json({ error: "Only faculty can regenerate enrollment codes" });
    }
    const { courseId } = req.params;
    const userId = req.user._id || req.user.id;
    if (!(await isUserInCourse(userId, courseId))) {
      return res.status(403).json({ error: "You must be a member of this course" });
    }

    const course = await getCourseById(courseId);
    if (!course) return res.status(404).json({ error: "Course not found" });

    const enrollmentCode = generateCourseAccessCode();
    await updateCourseEnrollmentCode(courseId, enrollmentCode);
    res.json({
      success: true,
      enrollmentCode,
      message: "Enrollment code regenerated. Share the new code with your students.",
    });
  } catch (error) {
    console.error("Error regenerating enrollment code:", error);
    res.status(500).json({ error: "Failed to regenerate enrollment code" });
  }
};

const getCourseSectionsHandler = async (req, res) => {
  try {
    if (!(await isFaculty(req.user))) {
      return res.status(403).json({ error: "Only faculty can view course sections" });
    }
    const { courseId } = req.params;
    const userId = req.user._id || req.user.id;
    if (!(await isUserInCourse(userId, courseId))) {
      return res.status(403).json({ error: "You must be a member of this course" });
    }
    const sections = await getCourseSections(courseId);
    res.json({ success: true, sections });
  } catch (error) {
    console.error("Error getting course sections:", error);
    res.status(500).json({ error: "Failed to retrieve course sections" });
  }
};

const getSectionStudentsHandler = async (req, res) => {
  try {
    if (!(await isFaculty(req.user))) {
      return res.status(403).json({ error: "Only faculty can view section students" });
    }
    const { courseId, sectionId } = req.params;
    const userId = req.user._id || req.user.id;
    if (!(await isUserInCourse(userId, courseId))) {
      return res.status(403).json({ error: "You must be a member of this course" });
    }
    const students = await getSectionStudents(courseId, sectionId);
    res.json({ success: true, students });
  } catch (error) {
    console.error("Error getting section students:", error);
    res.status(500).json({ error: "Failed to retrieve section students" });
  }
};

const addSectionsToCourseHandler = async (req, res) => {
  try {
    if (!(await isFaculty(req.user))) {
      return res.status(403).json({ error: "Only faculty can add sections to courses" });
    }

    const { courseId } = req.params;
    const { sectionIds, academicPeriod, academicPeriodName, syncStudents = false } = req.body;

    if (!academicPeriod) {
      return res.status(400).json({ error: "Academic period is required" });
    }
    if (!Array.isArray(sectionIds) || sectionIds.length === 0) {
      return res.status(400).json({ error: "Select at least one section" });
    }

    const course = await getCourseById(courseId);
    if (!course) {
      return res.status(404).json({ error: "Course not found" });
    }
    const userIdStr = String(req.user._id || req.user.id);
    if (course.owner.toString() !== userIdStr) {
      return res.status(403).json({ error: "You must be the course owner to add sections" });
    }

    const resolved = await resolveSectionsToCourse(sectionIds);
    if (resolved.error) return res.status(400).json({ error: resolved.error });

    const baseCode = buildCourseCode(resolved.courseTitle, course.campus);
    if (!course.courseCode.startsWith(baseCode)) {
      return res.status(400).json({ error: `Selected sections belong to a different course (${baseCode}). Expected ${course.courseCode}.` });
    }

    const userId = req.user._id || req.user.id;
    for (const s of resolved.sections) {
      try {
        await upsertCourseSection(courseId, {
          sectionId: s.courseSectionId,
          sectionNumber: s.sectionNumber || '',
          academicPeriod,
          academicPeriodName,
          owner: userId,
        });
      } catch (sectionError) {
        console.error("Error creating section:", sectionError);
      }
    }

    let syncResult = { added: 0 };
    if (syncStudents) {
      syncResult = await syncStudentsToCourse(courseId, sectionIds, academicPeriod);
    }

    res.json({
      success: true,
      message: "Sections successfully added.",
      syncResult,
    });
  } catch (error) {
    console.error("Error adding sections:", error);
    res.status(500).json({ error: "Failed to add sections" });
  }
};

const getMyCourseSectionsHandler = async (req, res) => {
  try {
    const { courseId } = req.params;
    const userId = req.user._id || req.user.id;
    console.log(`[getMyCourseSectionsHandler] START. userId: ${userId}, courseId: ${courseId}`);

    if (!(await isUserInCourse(userId, courseId))) {
      console.log(`[getMyCourseSectionsHandler] User not in course!`);
      return res.status(403).json({ error: "You must be a member of this course" });
    }

    let sections;
    if (await isFaculty(req.user)) {
      console.log(`[getMyCourseSectionsHandler] User is faculty.`);
      const course = await getCourseById(courseId);
      const courseOwnerId = course && course.owner ? course.owner.toString() : null;
      console.log(`[getMyCourseSectionsHandler] courseOwnerId: ${courseOwnerId}`);

      const allCourseSections = await getCourseSections(courseId);
      console.log(`[getMyCourseSectionsHandler] allCourseSections found: ${allCourseSections.length}`);

      sections = allCourseSections.filter(s => {
        const sectionOwnerId = s.owner ? s.owner.toString() : courseOwnerId;
        const matches = sectionOwnerId === userId.toString();
        console.log(`[getMyCourseSectionsHandler] section ${s._id} | owner: ${sectionOwnerId} | match: ${matches}`);
        return matches;
      });
    } else {
      console.log(`[getMyCourseSectionsHandler] User is NOT faculty.`);
      sections = await getUserCourseSections(userId, courseId);
    }

    console.log(`[getMyCourseSectionsHandler] Returning ${sections.length} sections.`);
    res.json({ success: true, sections });
  } catch (error) {
    console.error("Error getting user course sections:", error);
    res.status(500).json({ error: "Failed to retrieve your course sections" });
  }
};

// Sections of a course the current viewer is allowed to see: the course owner
// and app administrators get all sections; any other instructor gets only the
// sections they own. Used to scope the Quiz Scores section filter.
const getVisibleCourseSectionsHandler = async (req, res) => {
  try {
    const { courseId } = req.params;
    const userId = req.user._id || req.user.id;
    if (!(await isUserInCourse(userId, courseId))) {
      return res.status(403).json({ error: "You must be a member of this course" });
    }
    const { sections } = await getSectionsForViewer(courseId, req.user);
    res.json({ success: true, sections });
  } catch (error) {
    console.error("Error getting visible course sections:", error);
    res.status(500).json({ error: "Failed to retrieve sections" });
  }
};

const getMyOwnedSectionsHandler = async (req, res) => {
  try {
    if (!(await isFaculty(req.user))) {
      return res.status(403).json({ error: "Only faculty can view owned sections" });
    }
    const userId = req.user._id || req.user.id;
    const sections = await getSectionsByOwner(userId);
    res.json({ success: true, sections });
  } catch (error) {
    console.error("Error getting owned sections:", error);
    res.status(500).json({ error: "Failed to retrieve your owned sections" });
  }
};

const recycleSectionHandler = async (req, res) => {
  try {
    if (!(await isFaculty(req.user))) {
      return res.status(403).json({ error: "Only faculty can recycle sections" });
    }
    const { courseId, sectionId } = req.params;
    const userId = req.user._id || req.user.id;

    // Verify ownership
    const ownedSections = await getSectionsByOwner(userId);
    const ownsSection = ownedSections.some(s =>
      s.courseId.toString() === courseId.toString() && s.sectionId === sectionId
    );

    if (!ownsSection) {
      return res.status(403).json({ error: "You can only recycle sections that you own" });
    }

    const { recycleSection } = require('../services/course-section');
    await recycleSection(courseId, sectionId);
    res.json({ success: true, message: "Users detached successfully" });
  } catch (error) {
    console.error("Error recycling section:", error);
    res.status(500).json({ error: "Failed to recycle section" });
  }
};

module.exports = {
  getMyCourses,
  getCourseByIdHandler,
  getCourseMaterials,
  getCourseQuestions,
  addCourseMaterial,
  createNewCourse,
  listEnrollmentCourses,
  joinCourseWithCode,
  joinCourseByEnrollmentCode,
  getEnrollmentCode,
  regenerateEnrollmentCode,
  getCourseSectionsHandler,
  getSectionStudentsHandler,
  getMyCourseSectionsHandler,
  getMyOwnedSectionsHandler,
  getVisibleCourseSectionsHandler,
  recycleSectionHandler,
  addSectionsToCourseHandler,
};
