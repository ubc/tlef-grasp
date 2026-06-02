const crypto = require('crypto');
const {
  createCourse,
  getCourseByCourseCode,
  getCourseById,
  getCourseByEnrollmentCode,
  listCoursesForEnrollment,
  updateCourseEnrollmentCode,
} = require('../services/course');

const COURSE_ACCESS_CODE_LENGTH = 12;
const COURSE_ACCESS_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** Random alphanumeric string for course access links / codes */
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
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/** Remove enrollment secret from API payloads */
function omitCourseAccess(course) {
  if (!course) return course;
  const { courseAccess, ...rest } = course;
  return rest;
}

const { createUserCourse, getUserCourses, isUserInCourse } = require('../services/user-course');
const materialService = require('../services/material');
const questionService = require('../services/question');
const { isFaculty, isStudent } = require('../utils/auth');

const getMyCourses = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const userCourses = await getUserCourses(userId);
    const courses = userCourses.map((course) =>
      omitCourseAccess(course.course)
    );

    res.json({
      success: true,
      courses: courses,
    });
  } catch (error) {
    console.error("Error getting user courses:", error);
    res.status(500).json({ error: "Failed to retrieve courses" });
  }
};

const getCourseByIdHandler = async (req, res) => {
  try {
    const { courseId } = req.params;
    const course = await getCourseById(courseId);

    if (!course) {
      return res.status(404).json({ error: "Course not found" });
    }

    res.json({
      success: true,
      course: omitCourseAccess(course),
    });
  } catch (error) {
    console.error("Error getting course:", error);
    res.status(500).json({ error: "Failed to retrieve course" });
  }
};

const getCourseMaterials = async (req, res) => {
  try {
    const { courseId } = req.params;

    // Verify course exists
    const course = await getCourseById(courseId);
    if (!course) {
      return res.status(404).json({ error: "Course not found" });
    }

    const materials = await materialService.getCourseMaterials(courseId);

    res.json({
      success: true,
      materials: materials,
    });
  } catch (error) {
    console.error("Error getting course materials:", error);
    res.status(500).json({ error: "Failed to retrieve course materials" });
  }
};

const getCourseQuestions = async (req, res) => {
  try {
    const { courseId } = req.params;

    const course = await getCourseById(courseId);
    if (!course) {
      return res.status(404).json({ error: "Course not found" });
    }

    const questions = await questionService.getQuestions(courseId);

    res.json({
      success: true,
      questions: questions,
    });
  } catch (error) {
    console.error("Error getting course questions:", error);
    res.status(500).json({ error: "Failed to retrieve course questions" });
  }
};

const addCourseMaterial = async (req, res) => {
  try {
    const { courseId } = req.params;
    const { title, type, date, status = "pending", sourceId, fileContent, fileSize } = req.body;

    if (!title || !type) {
      return res.status(400).json({ error: "Title and type are required" });
    }

    const course = await getCourseById(courseId);
    if (!course) {
      return res.status(404).json({ error: "Course not found" });
    }

    // Generate a sourceId if not provided (e.g. for manual entries)
    const materialSourceId = sourceId || `m${Date.now()}`;

    await materialService.saveMaterial(materialSourceId, courseId, {
      fileType: type,
      fileSize: fileSize || 0,
      fileContent: fileContent,
      documentTitle: title,
    });

    // Fetch the stored material to return it
    const newMaterial = await materialService.getMaterialBySourceId(materialSourceId);

    res.json({
      success: true,
      message: "Material added successfully",
      material: newMaterial,
    });
  } catch (error) {
    console.error("Error adding course material:", error);
    res.status(500).json({ error: "Failed to add course material" });
  }
};

const createNewCourse = async (req, res) => {
  try {
    // Staff cannot create new courses
    if (!(await isFaculty(req.user))) {
      return res.status(403).json({
        error: "Only faculty can create new courses"
      });
    }

    const {
      courseCode,
      courseName,
      instructorName,
      semester,
      expectedStudents,
      courseDescription,
      courseWeeks,
      lecturesPerWeek,
      courseCredits,
      status = "active",
    } = req.body;

    // Validate required fields
    if (
      !courseCode ||
      !courseName ||
      !instructorName ||
      !semester ||
      !expectedStudents
    ) {
      return res.status(400).json({
        error:
          "Missing required fields: courseCode, courseName, instructorName, semester, and expectedStudents are required",
      });
    }

    // Check if course already exists
    const existingCourse = await getCourseByCourseCode(courseCode);
    if (existingCourse) {
      return res
        .status(409)
        .json({ error: "Course with this code already exists" });
    }

    const courseAccess = generateCourseAccessCode();

    // Prepare course data for database
    const courseData = {
      courseCode: courseCode.trim(),
      courseName: courseName.trim(),
      instructorName,
      semester: semester.trim(),
      expectedStudents,
      courseDescription: courseDescription || "",
      courseWeeks: courseWeeks || null,
      lecturesPerWeek: lecturesPerWeek || null,
      courseCredits: courseCredits || null,
      status: status,
      createdAt: new Date(),
      updatedAt: new Date(),
      courseAccess,
    };

    // Create course in database
    const result = await createCourse(courseData);
    const courseId = result.insertedId;

    // Get the current user from session (set by passport authentication)
    const userId = req.user?._id;
    if (userId) {
      // Create user-course relationship
      try {
        await createUserCourse(userId, courseId);
      } catch (userCourseError) {
        console.error("Error creating user-course relationship:", userCourseError);
        // Don't fail the request if user-course creation fails, but log it
      }
    }

    // Return the created course with all fields
    const newCourse = {
      _id: courseId.toString(),
      code: courseCode,
      courseName: courseName.trim(),
      instructor: instructorName,
      semester: semester,
      students: expectedStudents,
      description: courseDescription || "",
      weeks: courseWeeks || null,
      lecturesPerWeek: lecturesPerWeek || null,
      credits: courseCredits || null,
      status: status,
      courseAccess,
      materials: [],
      questions: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    res.status(201).json({
      success: true,
      message: "Course created successfully",
      course: newCourse,
    });
  } catch (error) {
    console.error("Error creating course:", error);
    res.status(500).json({
      error: "Failed to create course",
      details: error.message
    });
  }
};

const listEnrollmentCourses = async (req, res) => {
  try {
    if (!(await isStudent(req.user))) {
      return res.status(403).json({ error: "Only students can browse courses to join" });
    }

    const q = req.query.q || "";
    const courses = await listCoursesForEnrollment(q);
    const list = courses.map((c) => ({
      _id: c._id.toString(),
      courseCode: c.courseCode,
      courseName: c.courseName,
      instructorName: c.instructorName,
      semester: c.semester,
      status: c.status,
    }));

    res.json({ success: true, courses: list });
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
    if (!course) {
      return res.status(404).json({ error: "Course not found" });
    }

    if (course.status === "archived") {
      return res.status(403).json({ error: "This course is not accepting enrollments" });
    }

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
      course: {
        _id: course._id.toString(),
        courseCode: course.courseCode,
        courseName: course.courseName,
        instructorName: course.instructorName,
        semester: course.semester,
      },
    });
  } catch (error) {
    console.error("Error joining course:", error);
    res.status(500).json({ error: "Failed to join course" });
  }
};

/** Student joins using only the enrollment code (no courseId in URL). */
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
    if (!course) {
      // Keep error generic so we don't leak which courses exist
      return res.status(403).json({ error: "Invalid enrollment code" });
    }

    if (course.status === "archived") {
      return res.status(403).json({ error: "This course is not accepting enrollments" });
    }

    const userId = req.user._id || req.user.id;
    const courseId = course._id.toString();
    if (await isUserInCourse(userId, courseId)) {
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
      course: {
        _id: course._id.toString(),
        courseCode: course.courseCode,
        courseName: course.courseName,
        instructorName: course.instructorName,
        semester: course.semester,
      },
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
    if (!course) {
      return res.status(404).json({ error: "Course not found" });
    }

    if (!course.courseAccess) {
      const newCode = generateCourseAccessCode();
      await updateCourseEnrollmentCode(courseId, newCode);
      course = { ...course, courseAccess: newCode };
    }

    res.json({
      success: true,
      enrollmentCode: course.courseAccess,
    });
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
    if (!course) {
      return res.status(404).json({ error: "Course not found" });
    }

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
};
