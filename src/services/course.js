const databaseService = require('./database');
const { ObjectId } = require('mongodb');

/**
 * Schema: { _id, courseName, courseCode, campus,
 *           courseAccess, owner, nickname?, createdAt, updatedAt,
 *           archived?, archivedAt?, archivedBy? }
 *
 * Archiving is GRASP's soft delete. A live course carries `archived: false`
 * and an archived one `archived: true`. The field is written explicitly rather
 * than left absent because the unique courseCode index is partial on
 * `archived: false`, and a partial filter cannot express "field is missing"
 * (see initializeCollections in services/database.js, which also backfills
 * courses predating the field).
 *
 * The lookups below still filter on `archived: { $ne: true }` rather than
 * `archived: false`: it is equivalent for both shapes and stays correct for
 * any document the backfill has not reached yet. Archived courses also stop
 * reserving their courseCode and stop honouring their invite code, which is
 * why the filter lives in getCourseByCode/getCourseByEnrollmentCode rather
 * than at the call sites: freeing the code for next term's shell falls out
 * of it.
 *
 * Note: academicPeriod is intentionally NOT persisted — a course shell is
 * meant to be reused across semesters. The selected sections are stored, but
 * the period that owned the original sync is only used transiently at create
 * time (and at any future re-sync the user explicitly initiates).
 *
 * The period shown next to a course in the switcher is therefore DERIVED from
 * its sections (grasp_course_section.academicPeriod), not read from here — see
 * getUserCourses in services/user-course.js. That keeps a reused shell showing
 * the term it is actually being taught in rather than the term it was born in.
 *
 * `nickname` is the course-level label an owner can set to tell two shells of
 * the same course apart. It is deliberately on the course rather than on the
 * membership: one nickname, visible to co-instructors, TAs and students alike.
 * Per-user ordering of the switcher is the opposite — that lives on the
 * membership (grasp_user_course.displayOrder).
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
        if (!courseData.campus) {
            throw new Error("Campus is required");
        }

        const collection = db.collection("grasp_course");
        const now = new Date();
        const course = await collection.insertOne({
            courseName: courseData.courseName,
            courseCode: courseData.courseCode,
            campus: courseData.campus,
            courseAccess: courseData.courseAccess,
            owner: courseData.owner,
            ubcCourseId: courseData.ubcCourseId,
            // Explicit, not absent: the partial unique index on courseCode
            // selects `archived: false`, so a course without the field would
            // never reserve its code.
            archived: false,
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
        if (typeof courseId === 'string' && !ObjectId.isValid(courseId)) {
            return null;
        }
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
        return db.collection("grasp_course").findOne({
            courseCode,
            archived: { $ne: true },
        });
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
        const filter = { archived: { $ne: true } };
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

/**
 * Longest nickname we will store. The switcher is a narrow sidebar <select>,
 * so anything past this is unreadable in the place it exists to help.
 */
const MAX_NICKNAME_LENGTH = 60;

/**
 * Set (or clear) a course's nickname. A blank nickname unsets the field rather
 * than storing an empty string, so the label builders can treat "absent" as the
 * only falsy case they need to handle.
 * @param {string|ObjectId} courseId
 * @param {string} nickname - Trimmed and truncated; blank clears the nickname.
 */
async function updateCourseNickname(courseId, nickname) {
    const db = await databaseService.connect();
    const collection = db.collection("grasp_course");
    const id = typeof courseId === "string" ? new ObjectId(courseId) : courseId;
    const trimmed = String(nickname ?? "").trim().slice(0, MAX_NICKNAME_LENGTH);

    const update = trimmed
        ? { $set: { nickname: trimmed, updatedAt: new Date() } }
        : { $unset: { nickname: "" }, $set: { updatedAt: new Date() } };

    await collection.updateOne({ _id: id }, update);
    return trimmed;
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
        return db.collection("grasp_course").findOne({
            courseAccess: trimmed,
            archived: { $ne: true },
        });
    } catch (error) {
        console.error("Error getting course by enrollment code:", error);
        throw error;
    }
}

/**
 * Flag a course as archived (GRASP's soft delete). Nothing else is touched:
 * memberships, quizzes, schedules, materials, and the course's Qdrant
 * collection all survive untouched, so unarchiving restores the course exactly
 * as it was. Access is cut by the read filters above and by the
 * requireActiveCourse middleware, not by mutating anything downstream.
 * @param {string|ObjectId} courseId
 * @param {string|ObjectId} archivedBy - The owner/admin performing the archive
 */
async function archiveCourse(courseId, archivedBy) {
    const db = await databaseService.connect();
    const id = typeof courseId === "string" ? new ObjectId(courseId) : courseId;
    const by = typeof archivedBy === "string" && ObjectId.isValid(archivedBy)
        ? new ObjectId(archivedBy)
        : archivedBy;
    return db.collection("grasp_course").updateOne(
        { _id: id },
        {
            $set: {
                archived: true,
                archivedAt: new Date(),
                archivedBy: by ?? null,
                updatedAt: new Date(),
            },
        }
    );
}

/**
 * Restore an archived course, optionally under a new course code (the caller
 * checks for a collision first — archiving released the old code, so another
 * shell may hold it by now).
 * @param {string|ObjectId} courseId
 * @param {string} [courseCode] - Replacement code, when the original is taken
 */
async function unarchiveCourse(courseId, courseCode) {
    const db = await databaseService.connect();
    const id = typeof courseId === "string" ? new ObjectId(courseId) : courseId;
    const update = {
        // archived goes back to an explicit false rather than being unset, so
        // the restored course re-enters the partial unique index on courseCode.
        $unset: { archivedAt: "", archivedBy: "" },
        $set: { archived: false, updatedAt: new Date() },
    };
    if (courseCode) update.$set.courseCode = courseCode;
    return db.collection("grasp_course").updateOne({ _id: id }, update);
}

/**
 * Archived courses owned by a user — the backing list for the "Archived
 * courses" tab in the Manage-courses hub.
 *
 * Deliberately scoped to ownership rather than to isCourseManager: an app
 * administrator manages every course, and a list of every archived course in
 * the deployment is not a useful page. Administrators can still open any
 * archived course by id.
 * @param {string|ObjectId} ownerId
 */
async function listArchivedCoursesForOwner(ownerId) {
    if (!ownerId) return [];
    const db = await databaseService.connect();
    const id = typeof ownerId === "string" && ObjectId.isValid(ownerId)
        ? new ObjectId(ownerId)
        : ownerId;
    return db
        .collection("grasp_course")
        .find({ archived: true, $or: [{ owner: id }, { owner: String(ownerId) }] })
        .sort({ archivedAt: -1 })
        .toArray();
}

module.exports = {
    MAX_NICKNAME_LENGTH,
    createCourse,
    updateCourseNickname,
    archiveCourse,
    unarchiveCourse,
    listArchivedCoursesForOwner,
    getCourseById,
    getCourseByCode,
    findAvailableCourseCode,
    getCourseByEnrollmentCode,
    listCoursesForEnrollment,
    updateCourseEnrollmentCode,
};
