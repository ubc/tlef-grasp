const databaseService = require('./database');
const { ObjectId } = require('mongodb');

const createUserCourse = async (userId, courseId) => {
    try {
        const db = await databaseService.connect();
        const collection = db.collection("grasp_user_course");
        
        // Convert userId and courseId to ObjectId if they're strings
        const userIdObj = typeof userId === 'string' ? new ObjectId(userId) : userId;
        const courseIdObj = typeof courseId === 'string' ? new ObjectId(courseId) : courseId;
        
        const userCourse = await collection.insertOne({ 
            userId: userIdObj, 
            courseId: courseIdObj 
        });
        return userCourse;
    } catch (error) {
        console.error("Error creating user course:", error);
        throw error;
    }
};

const deleteUserCourseByUserID = async (userId) => {
    try {
        const db = await databaseService.connect();
        const collection = db.collection("grasp_user_course");
        
        // Convert userId to ObjectId if it's a string
        const userIdObj = typeof userId === 'string' ? new ObjectId(userId) : userId;
        
        const result = await collection.deleteMany({ userId: userIdObj });
        return result;
    } catch (error) {
        console.error("Error deleting user course:", error);
        throw error;
    }
};

const deleteUserCourseByCourseID = async (courseId) => {
    try {
        const db = await databaseService.connect();
        const collection = db.collection("grasp_user_course");
        
        // Convert courseId to ObjectId if it's a string
        const courseIdObj = typeof courseId === 'string' ? new ObjectId(courseId) : courseId;
        
        const result = await collection.deleteMany({ courseId: courseIdObj });
        return result;
    } catch (error) {
        console.error("Error deleting user course:", error);
        throw error;
    }
};

/**
 * Get user courses with full course details using MongoDB $lookup (JOIN)
 * @param {string|ObjectId} userId - User ID
 * @returns {Promise<Array>} Array of user-course documents with populated course details
 */
const getUserCourses = async (userId) => {
    try {
        const db = await databaseService.connect();
        const collection = db.collection("grasp_user_course");
        
        // Convert userId to ObjectId if it's a string
        const userIdObj = typeof userId === 'string' && ObjectId.isValid(userId) ? new ObjectId(userId) : userId;
        
        console.log('[getUserCourses] Input userId:', userId, 'Type:', typeof userId);
        console.log('[getUserCourses] Converted userIdObj:', userIdObj);
        
        // Debug: Check all records in user_course for this user
        const simpleQuery = await collection.find({
            $or: [
                { userId: userIdObj },
                { userId: userId },
                { userId: String(userId) }
            ]
        }).toArray();
        console.log('[getUserCourses] Simple query results:', JSON.stringify(simpleQuery, null, 2));
        
        // Use aggregation with $lookup to join with courses collection
        const userCourses = await collection.aggregate([
            // Match user courses for this user
            // Handle both ObjectId and string userId
            {
                $match: {
                    $or: [
                        { userId: userIdObj },
                        { userId: userId }
                    ]
                }
            },
            // Join with courses collection
            // Note: If courseId is stored as string, convert it in $lookup
            {
                $lookup: {
                    from: "grasp_course",
                    let: { 
                        // Convert courseId to ObjectId if it's a string
                        courseIdToMatch: {
                            $cond: {
                                if: { $eq: [{ $type: "$courseId" }, "string"] },
                                then: { $toObjectId: "$courseId" },
                                else: "$courseId"
                            }
                        }
                    },
                    pipeline: [
                        {
                            $match: {
                                $expr: { $eq: ["$_id", "$$courseIdToMatch"] }
                            }
                        }
                    ],
                    as: "course"
                }
            },
            // Unwind the course array (since $lookup returns an array)
            { $unwind: { path: "$course", preserveNullAndEmptyArrays: true } },
            // Archived courses are invisible to everyone here — owner included.
            // The owner reaches them through /api/courses/archived instead, so
            // this one filter is what removes a soft-deleted course from both
            // /api/courses/my and /api/student/courses. An orphaned membership
            // (course row missing) has no `course.archived` and still passes,
            // preserving the existing behaviour for those.
            { $match: { "course.archived": { $ne: true } } },
            // Derive the course's academic period from its sections. The period
            // is deliberately not stored on the course (see the schema note in
            // services/course.js: a shell is reused across terms), so the only
            // truthful answer is the newest term the course actually has
            // sections in.
            //
            // Sorting the raw period code descending is chronological, not just
            // alphabetical: within an academic year the codes read S1 < S2 <
            // W1 < W2, which is exactly May < July < September < January. A
            // section with no period code sorts last, so a real code always
            // wins over a missing one.
            {
                $lookup: {
                    from: "grasp_course_section",
                    let: { courseIdToMatch: "$course._id" },
                    pipeline: [
                        { $match: { $expr: { $eq: ["$courseId", "$$courseIdToMatch"] } } },
                        { $sort: { academicPeriod: -1 } },
                        { $limit: 1 },
                        { $project: { _id: 0, academicPeriod: 1, academicPeriodName: 1 } },
                    ],
                    as: "latestSection",
                },
            },
            {
                $addFields: {
                    // Written into the course sub-document as well as the top
                    // level: /api/courses/my returns `course` verbatim, while
                    // getStudentCourses reads the flattened fields.
                    "course.academicPeriod": { $first: "$latestSection.academicPeriod" },
                    "course.academicPeriodName": { $first: "$latestSection.academicPeriodName" },
                    // Courses the user has never reordered sort after the ones
                    // they have, then alphabetically among themselves.
                    orderKey: { $ifNull: ["$displayOrder", Number.MAX_SAFE_INTEGER] },
                },
            },
            { $sort: { orderKey: 1, "course.courseName": 1 } },
            // Reshape the output to include course fields at top level
            {
                $project: {
                    _id: 1,
                    userId: 1,
                    courseId: 1,
                    // Include all course fields at top level for easier access
                    courseName: "$course.courseName",
                    courseCode: "$course.courseCode",
                    nickname: "$course.nickname",
                    academicPeriod: "$course.academicPeriod",
                    academicPeriodName: "$course.academicPeriodName",
                    createdAt: "$course.createdAt",
                    displayOrder: 1,
                    // Keep full course object if needed
                    course: 1
                }
            }
        ]).toArray();
        
        return userCourses;
    } catch (error) {
        console.error("Error getting user courses:", error);
        throw error;
    }
};


/**
 * Get course users with full user details using MongoDB $lookup (JOIN)
 * @param {string|ObjectId} courseId - Course ID
 * @returns {Promise<Array>} Array of user-course documents with populated user details
 */
const getCourseUsers = async (courseId) => {
    try {
        const db = await databaseService.connect();
        const collection = db.collection("grasp_user_course");
        
        // Convert courseId to ObjectId if it's a string
        const courseIdObj = typeof courseId === 'string' ? new ObjectId(courseId) : courseId;
        
        // Use aggregation with $lookup to join with users collection
        const courseUsers = await collection.aggregate([
            // Match user courses for this course
            // Handle both ObjectId and string courseId
            {
                $match: {
                    $or: [
                        { courseId: courseIdObj },
                        { courseId: courseId }
                    ]
                }
            },
            // Join with users collection
            {
                $lookup: {
                    from: "grasp_user",
                    let: { 
                        // Convert userId to ObjectId if it's a string
                        userIdToMatch: {
                            $cond: {
                                if: { $eq: [{ $type: "$userId" }, "string"] },
                                then: { $toObjectId: "$userId" },
                                else: "$userId"
                            }
                        }
                    },
                    pipeline: [
                        {
                            $match: {
                                $expr: { $eq: ["$_id", "$$userIdToMatch"] }
                            }
                        }
                    ],
                    as: "user"
                }
            },
            // Unwind the user array (since $lookup returns an array)
            { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
            // Join with user_course_section collection to get user's sections in this course
            {
                $lookup: {
                    from: "grasp_user_course_section",
                    let: {
                        userIdMatch: {
                            $cond: {
                                if: { $eq: [{ $type: "$userId" }, "string"] },
                                then: { $toObjectId: "$userId" },
                                else: "$userId"
                            }
                        },
                        courseIdMatch: {
                            $cond: {
                                if: { $eq: [{ $type: "$courseId" }, "string"] },
                                then: { $toObjectId: "$courseId" },
                                else: "$courseId"
                            }
                        }
                    },
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $and: [
                                        { $eq: ["$userId", "$$userIdMatch"] },
                                        { $eq: ["$courseId", "$$courseIdMatch"] }
                                    ]
                                }
                            }
                        }
                    ],
                    as: "userSections"
                }
            },
            // Reshape the output to include user fields at top level
            {
                $project: {
                    _id: 1,
                    userId: 1,
                    courseId: 1,
                    courseRole: 1,
                    taPermissions: 1,
                    // Include all user fields at top level for easier access
                    puid: "$user.puid",
                    displayName: "$user.displayName",
                    legalName: "$user.legalName",
                    email: "$user.email",
                    affiliation: "$user.affiliation",
                    registeredAt: "$user.registeredAt",
                    updatedAt: "$user.updatedAt",
                    sections: "$userSections.sectionId",
                    // Keep full user object if needed
                    user: 1
                }
            }
        ]).toArray();
        
        return courseUsers;
    } catch (error) {
        console.error("Error getting course users:", error);
        throw error;
    }
};

/**
 * Get user courses (alternative: returns only course IDs, then fetch course details separately)
 * Use this if you prefer manual fetching over aggregation
 * @param {string|ObjectId} userId - User ID
 * @returns {Promise<Array>} Array of course IDs
 */
const getUserCourseIds = async (userId) => {
    try {
        const db = await databaseService.connect();
        const collection = db.collection("grasp_user_course");
        const userIdObj = typeof userId === 'string' ? new ObjectId(userId) : userId;
        // Handle both ObjectId and string userId
        const userCourses = await collection.find({
            $or: [
                { userId: userIdObj },
                { userId: userId }
            ]
        }).toArray();
        return userCourses.map(uc => uc.courseId);
    } catch (error) {
        console.error("Error getting user course IDs:", error);
        throw error;
    }
};

/**
 * Get course users (alternative: returns only user IDs, then fetch user details separately)
 * Use this if you prefer manual fetching over aggregation
 * @param {string|ObjectId} courseId - Course ID
 * @returns {Promise<Array>} Array of user IDs
 */
const getCourseUserIds = async (courseId) => {
    try {
        const db = await databaseService.connect();
        const collection = db.collection("grasp_user_course");
        const courseIdObj = typeof courseId === 'string' ? new ObjectId(courseId) : courseId;
        // Handle both ObjectId and string courseId
        const courseUsers = await collection.find({
            $or: [
                { courseId: courseIdObj },
                { courseId: courseId }
            ]
        }).toArray();
        return courseUsers.map(cu => cu.userId);
    } catch (error) {
        console.error("Error getting course user IDs:", error);
        throw error;
    }
};

/**
 * Get the membership document linking a user to a course (or null).
 * The document may carry a courseRole (currently only 'ta') describing a
 * course-scoped designation on top of the user's global affiliations.
 * @param {string|ObjectId} userId - User ID
 * @param {string|ObjectId} courseId - Course ID
 * @returns {Promise<Object|null>} Membership document or null
 */
const getUserCourseMembership = async (userId, courseId) => {
    try {
        const db = await databaseService.connect();
        const collection = db.collection("grasp_user_course");

        const userIdObj = typeof userId === 'string' && ObjectId.isValid(userId) ? new ObjectId(userId) : userId;
        const courseIdObj = typeof courseId === 'string' && ObjectId.isValid(courseId) ? new ObjectId(courseId) : courseId;

        return collection.findOne({
            $or: [
                { userId: userIdObj, courseId: courseIdObj },
                { userId: userId, courseId: courseId },
                { userId: String(userId), courseId: String(courseId) }
            ]
        });
    } catch (error) {
        console.error("Error getting user course membership:", error);
        throw error;
    }
};

/**
 * Set or clear the course-scoped role on a membership document.
 * @param {string|ObjectId} userId - User ID
 * @param {string|ObjectId} courseId - Course ID
 * @param {string|null} courseRole - Role to set (e.g. 'ta'), or null to clear
 * @returns {Promise} Update result
 */
const setUserCourseRole = async (userId, courseId, courseRole) => {
    try {
        const db = await databaseService.connect();
        const collection = db.collection("grasp_user_course");

        const userIdObj = typeof userId === 'string' && ObjectId.isValid(userId) ? new ObjectId(userId) : userId;
        const courseIdObj = typeof courseId === 'string' && ObjectId.isValid(courseId) ? new ObjectId(courseId) : courseId;

        const filter = {
            $or: [
                { userId: userIdObj, courseId: courseIdObj },
                { userId: userId, courseId: courseId },
                { userId: String(userId), courseId: String(courseId) }
            ]
        };
        const update = courseRole
            ? { $set: { courseRole } }
            : { $unset: { courseRole: '' } };
        return collection.updateOne(filter, update);
    } catch (error) {
        console.error("Error setting user course role:", error);
        throw error;
    }
};

/**
 * Replace the TA permission map on a membership document. Stored under
 * taPermissions (key -> boolean); pass null to clear it (e.g. on demotion).
 * @param {string|ObjectId} userId - User ID
 * @param {string|ObjectId} courseId - Course ID
 * @param {Object|null} permissions - Sanitized permission map, or null to clear
 * @returns {Promise} Update result
 */
const setUserCourseTaPermissions = async (userId, courseId, permissions) => {
    try {
        const db = await databaseService.connect();
        const collection = db.collection("grasp_user_course");

        const userIdObj = typeof userId === 'string' && ObjectId.isValid(userId) ? new ObjectId(userId) : userId;
        const courseIdObj = typeof courseId === 'string' && ObjectId.isValid(courseId) ? new ObjectId(courseId) : courseId;

        const filter = {
            $or: [
                { userId: userIdObj, courseId: courseIdObj },
                { userId: userId, courseId: courseId },
                { userId: String(userId), courseId: String(courseId) }
            ]
        };
        const update = permissions
            ? { $set: { taPermissions: permissions } }
            : { $unset: { taPermissions: '' } };
        return collection.updateOne(filter, update);
    } catch (error) {
        console.error("Error setting user course TA permissions:", error);
        throw error;
    }
};

/**
 * Count how many courses a user holds the 'ta' course role in.
 * Used to decide whether a demotion should also revoke the promoted staff
 * affiliation (only when this drops to zero).
 * @param {string|ObjectId} userId - User ID
 * @returns {Promise<number>} Number of TA memberships
 */
const countTaMemberships = async (userId) => {
    try {
        const db = await databaseService.connect();
        const collection = db.collection("grasp_user_course");

        const userIdObj = typeof userId === 'string' && ObjectId.isValid(userId) ? new ObjectId(userId) : userId;

        return collection.countDocuments({
            courseRole: 'ta',
            $or: [
                { userId: userIdObj },
                { userId: userId },
                { userId: String(userId) }
            ]
        });
    } catch (error) {
        console.error("Error counting TA memberships:", error);
        throw error;
    }
};

const isUserInCourse = async (userId, courseId) => {
    try {
        const db = await databaseService.connect();
        const collection = db.collection("grasp_user_course");
        
        // Convert userId and courseId to ObjectId if they're strings
        const userIdObj = typeof userId === 'string' && ObjectId.isValid(userId) ? new ObjectId(userId) : userId;
        const courseIdObj = typeof courseId === 'string' && ObjectId.isValid(courseId) ? new ObjectId(courseId) : courseId;
        
        // Try both ObjectId and string formats for compatibility
        const result = await collection.findOne({ 
            $or: [
                { userId: userIdObj, courseId: courseIdObj },
                { userId: userId, courseId: courseId },
                { userId: String(userId), courseId: String(courseId) }
            ]
        });
        return result ? true : false;
    } catch (error) {
        console.error("Error checking if user is in course:", error);
        throw error;
    }
};

/**
 * Delete a specific user-course relationship
 * @param {string|ObjectId} userId - User ID
 * @param {string|ObjectId} courseId - Course ID
 * @returns {Promise} Delete result
 */
const deleteUserCourse = async (userId, courseId) => {
    try {
        const db = await databaseService.connect();
        const collection = db.collection("grasp_user_course");
        
        // Convert to ObjectId if strings
        const userIdObj = typeof userId === 'string' ? new ObjectId(userId) : userId;
        const courseIdObj = typeof courseId === 'string' ? new ObjectId(courseId) : courseId;
        
        const result = await collection.deleteOne({ 
            userId: userIdObj, 
            courseId: courseIdObj 
        });
        return result;
    } catch (error) {
        console.error("Error deleting user course:", error);
        throw error;
    }
};

/**
 * Get student courses in a simplified format for frontend consumption
 * @param {string|ObjectId} userId - User ID
 * @returns {Promise<Array>} Array of courses with id and name
 */
const getStudentCourses = async (userId) => {
    try {
        console.log('[getStudentCourses] Looking up courses for userId:', userId);
        const userCourses = await getUserCourses(userId);
        console.log('[getStudentCourses] Raw userCourses result:', JSON.stringify(userCourses, null, 2));
        
        // Transform to expected format: { id, name, ... }
        // nickname and the derived academic period ride along so a student's
        // switcher labels courses the same way an instructor's does.
        const transformed = userCourses.map(uc => ({
            _id: uc.courseId ? uc.courseId.toString() : '',
            id: uc.courseId ? uc.courseId.toString() : '',
            name: uc.courseName || 'Unknown Course',
            courseName: uc.courseName || '',
            courseCode: uc.courseCode || '',
            nickname: uc.nickname || '',
            academicPeriod: uc.academicPeriod || '',
            academicPeriodName: uc.academicPeriodName || '',
        })).filter(course => course.id); // Filter out courses without valid ID
        
        console.log('[getStudentCourses] Transformed courses:', JSON.stringify(transformed, null, 2));
        return transformed;
    } catch (error) {
        console.error("[getStudentCourses] Error:", error);
        throw error;
    }
};

/**
 * Persist one user's preferred order for the course switcher.
 *
 * The caller sends the whole ordered list rather than a "move this one up"
 * delta: writing absolute positions is idempotent, so a double-clicked arrow or
 * two tabs racing each other converge on the same order instead of drifting.
 *
 * Ids the user has no membership for simply match nothing — the filter is
 * scoped to their own rows, so this cannot reorder anyone else's switcher.
 * @param {string|ObjectId} userId
 * @param {Array<string|ObjectId>} courseIds - Full list, in the desired order
 * @returns {Promise<number>} How many memberships were repositioned
 */
const setUserCourseOrder = async (userId, courseIds) => {
    if (!Array.isArray(courseIds) || courseIds.length === 0) return 0;

    const db = await databaseService.connect();
    const collection = db.collection("grasp_user_course");

    const userIdObj = typeof userId === 'string' && ObjectId.isValid(userId)
        ? new ObjectId(userId)
        : userId;

    // Memberships were not always written with ObjectId courseIds, so match
    // both shapes the same way getUserCourses does.
    const operations = courseIds.map((courseId, index) => {
        const asString = String(courseId);
        const courseIdMatches = [{ courseId: asString }];
        if (ObjectId.isValid(asString)) {
            courseIdMatches.unshift({ courseId: new ObjectId(asString) });
        }
        return {
            updateOne: {
                filter: {
                    $and: [
                        { $or: [{ userId: userIdObj }, { userId: String(userId) }] },
                        { $or: courseIdMatches },
                    ],
                },
                update: { $set: { displayOrder: index } },
            },
        };
    });

    const result = await collection.bulkWrite(operations, { ordered: false });
    return result.modifiedCount || 0;
};

module.exports = {
    createUserCourse,
    getUserCourses,
    setUserCourseOrder,
    getUserCourseIds,
    getCourseUsers,
    getCourseUserIds,
    deleteUserCourseByUserID,
    deleteUserCourseByCourseID,
    deleteUserCourse,
    isUserInCourse,
    getUserCourseMembership,
    setUserCourseRole,
    setUserCourseTaPermissions,
    countTaMemberships,
    getStudentCourses,
};