const databaseService = require('./database');
const { ObjectId } = require('mongodb');

/**
 * Schema: { _id, courseName, courseCode, campus, courseSectionIds,
 *           courseAccess, createdAt, updatedAt }
 *
 * Note: academicPeriod is intentionally NOT persisted — a course shell is
 * meant to be reused across semesters. The selected sections are stored, but
 * the period that owned the original sync is only used transiently at create
 * time (and at any future re-sync the user explicitly initiates).
 */
async function createCourse(courseData) {
    try {
        const db = await databaseService.connect();

        if (!courseData.courseName) {
            throw new Error("Course name is required");
        }
        if (!courseData.courseCode) {
            throw new Error("Course code is required");
        }
        if (!Array.isArray(courseData.courseSectionIds) || courseData.courseSectionIds.length === 0) {
            throw new Error("At least one course section is required");
        }

        const collection = db.collection("grasp_course");
        const now = new Date();
        const course = await collection.insertOne({
            courseName: courseData.courseName,
            courseCode: courseData.courseCode,
            campus: courseData.campus,
            courseSectionIds: courseData.courseSectionIds,
            courseAccess: courseData.courseAccess,
            createdAt: now,
            updatedAt: now,
        });

        try {
            const ragService = require('./rag');
            await ragService.getOrCreateInstance(course.insertedId);
            console.log(`Initialized Qdrant collection for course ${course.insertedId}`);
        } catch (ragError) {
            console.error("Failed to initialize Qdrant collection for course:", ragError);
        }

        return course;
    } catch (error) {
        console.error("Error creating course:", error);
        throw error;
    }
}

async function getCourseById(courseId) {
    try {
        const db = await databaseService.connect();
        const collection = db.collection("grasp_course");
        const id = typeof courseId === 'string' ? new ObjectId(courseId) : courseId;
        return collection.findOne({ _id: id });
    } catch (error) {
        console.error("Error getting course by ID:", error);
        throw error;
    }
}

async function getCourseByCode(courseCode) {
    if (!courseCode) return null;
    try {
        const db = await databaseService.connect();
        return db.collection("grasp_course").findOne({ courseCode });
    } catch (error) {
        console.error("Error getting course by code:", error);
        throw error;
    }
}

/**
 * Return `baseCode` if unused, else `baseCode-1`, `baseCode-2`, ... up to a cap.
 * Used when an instructor force-creates a shell despite a collision.
 */
async function findAvailableCourseCode(baseCode, maxAttempts = 50) {
    if (!baseCode) return baseCode;
    if (!(await getCourseByCode(baseCode))) return baseCode;
    for (let i = 1; i <= maxAttempts; i++) {
        const candidate = `${baseCode}-${i}`;
        if (!(await getCourseByCode(candidate))) return candidate;
    }
    return null;
}

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function listCoursesForEnrollment(searchQuery) {
    try {
        const db = await databaseService.connect();
        const collection = db.collection("grasp_course");
        const filter = {};
        if (searchQuery && String(searchQuery).trim()) {
            const q = escapeRegex(String(searchQuery).trim());
            const regex = new RegExp(q, "i");
            filter.$or = [
                { courseName: regex },
                { courseCode: regex },
            ];
        }
        return collection
            .find(filter)
            .project({ courseName: 1, courseCode: 1 })
            .sort({ courseName: 1 })
            .limit(300)
            .toArray();
    } catch (error) {
        console.error("Error listing courses for enrollment:", error);
        throw error;
    }
}

async function updateCourseEnrollmentCode(courseId, courseAccess) {
    const db = await databaseService.connect();
    const collection = db.collection("grasp_course");
    const id = typeof courseId === "string" ? new ObjectId(courseId) : courseId;
    return collection.updateOne(
        { _id: id },
        { $set: { courseAccess, updatedAt: new Date() } }
    );
}

async function getCourseByEnrollmentCode(code) {
    if (!code || typeof code !== "string") return null;
    const trimmed = code.trim();
    if (!trimmed) return null;
    try {
        const db = await databaseService.connect();
        return db.collection("grasp_course").findOne({ courseAccess: trimmed });
    } catch (error) {
        console.error("Error getting course by enrollment code:", error);
        throw error;
    }
}

module.exports = {
    createCourse,
    getCourseById,
    getCourseByCode,
    findAvailableCourseCode,
    getCourseByEnrollmentCode,
    listCoursesForEnrollment,
    updateCourseEnrollmentCode,
};
