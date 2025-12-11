const databaseService = require('./database');

async function createCourse(courseData) {
    try {
        const db = await databaseService.connect();

        if (!courseData.courseCode) {
            throw new Error("Course code is required");
        }

        // Check if course already exists (await the async call)
        const existingCourse = await getCourseByCourseCode(courseData.courseCode);
        if (existingCourse) {
            throw new Error("Course already exists");
        }

        const collection = db.collection("grasp_course");
        const course = await collection.insertOne({
            courseCode: courseData.courseCode,
            courseTitle: courseData.courseTitle,
            courseName: courseData.courseName,
            instructorName: courseData.instructorName,
            semester: courseData.semester,
            expectedStudents: courseData.expectedStudents,
            courseDescription: courseData.courseDescription,
            courseWeeks: courseData.courseWeeks,
            lecturesPerWeek: courseData.lecturesPerWeek,
            courseCredits: courseData.courseCredits,
            status: courseData.status || "active",
            createdAt: courseData.createdAt || new Date(),
            updatedAt: courseData.updatedAt || new Date(),
        });
        return course;
    } catch (error) {
        console.error("Error creating course:", error);
        throw error;
    }
}

async function getAllCourses() {
    try {
        const db = await databaseService.connect();
        const collection = db.collection("grasp_course");
        const courses = await collection.find({}).toArray();
        return courses;
    } catch (error) {
        console.error("Error getting all courses:", error);
        throw error;
    }
}

async function getCourseByCourseCode(courseCode) {
    try {
        const db = await databaseService.connect();
        const collection = db.collection("grasp_course");
        const course = await collection.findOne({ courseCode: courseCode });
        return course;
    } catch (error) {
        console.error("Error getting course by course code:", error);
        throw error;
    }
}

/**
 * Get course by MongoDB ObjectId
 * @param {string|ObjectId} courseId - Course ID (ObjectId or string)
 * @returns {Promise<Object|null>} Course document or null if not found
 */
async function getCourseById(courseId) {
    try {
        const db = await databaseService.connect();
        const collection = db.collection("grasp_course");
        const { ObjectId } = require('mongodb');
        
        // Convert string to ObjectId if needed
        const id = typeof courseId === 'string' ? new ObjectId(courseId) : courseId;
        const course = await collection.findOne({ _id: id });
        return course;
    } catch (error) {
        console.error("Error getting course by ID:", error);
        throw error;
    }
}

module.exports = {
    createCourse,
    getAllCourses,
    getCourseByCourseCode,
    getCourseById,
};