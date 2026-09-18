const databaseService = require('./database');
const { ObjectId } = require('mongodb');

async function createOrUpdateUser(userData) {
    try {
        if (!userData.puid) {
            throw new Error("Puid is required");
        }

        const db = await databaseService.connect();

        const collection = db.collection("grasp_user");
        // Fields refreshed from the identity source on every upsert.
        const set = {
            puid: userData.puid,
            email: userData.email,
            affiliation: userData.affiliation,
            updatedAt: new Date(),
        };
        // legalName is the authoritative CWL/IAM name shown to instructors.
        // Refresh it whenever the caller supplies one.
        if (userData.legalName !== undefined) {
            set.legalName = userData.legalName;
        }

        const setOnInsert = { registeredAt: new Date() };
        // displayName is the student-editable preferred name: seed it when the
        // user is first created, but never overwrite a student's later edits on
        // re-login or roster re-sync.
        if (userData.displayName !== undefined) {
            setOnInsert.displayName = userData.displayName;
        }

        // Use upsert to update existing user or create new one
        const result = await collection.updateOne(
            { puid: userData.puid },
            {
                $set: set,
                $setOnInsert: setOnInsert,
            },
            { upsert: true }
        );
        return result;
    } catch (error) {
        console.error("Error saving user:", error);
        throw error;
    }
}

async function getUserByPuid(puid) {
    try {
        const db = await databaseService.connect();

        const collection = db.collection("grasp_user");
        const user = await collection.findOne({ puid: puid });
        return user;
    } catch (error) {
        console.error("Error getting user by PUID:", error);
        throw error;
    }
}

/**
 * Update a user's name fields directly by PUID. Kept separate from
 * createOrUpdateUser so a returning login can refresh the authoritative legal
 * name (and, when a displayName was never personalized, upgrade it) without
 * touching email or affiliation (which may carry a TA promotion granted outside
 * of SAML). Only the provided fields are written.
 * @param {string} puid - CWL PUID
 * @param {{ displayName?: string, legalName?: string }} names
 */
async function updateUserNames(puid, names = {}) {
    try {
        if (!puid) throw new Error("Puid is required");
        const db = await databaseService.connect();
        const collection = db.collection("grasp_user");
        const set = { updatedAt: new Date() };
        if (names.displayName !== undefined) set.displayName = names.displayName;
        if (names.legalName !== undefined) set.legalName = names.legalName;
        return collection.updateOne({ puid }, { $set: set });
    } catch (error) {
        console.error("Error updating user names:", error);
        throw error;
    }
}

/**
 * Refresh only the authoritative CWL/IAM legal name for an existing user.
 * @param {string} puid - CWL PUID
 * @param {string} legalName - Authoritative name from the identity provider
 */
function updateUserLegalName(puid, legalName) {
    return updateUserNames(puid, { legalName });
}

async function getUserById(userId) {
    try {
        const db = await databaseService.connect();
        const { ObjectId } = require('mongodb');

        const collection = db.collection("grasp_user");
        const filter = userId && ObjectId.isValid(String(userId))
            ? { _id: new ObjectId(String(userId)) }
            : { _id: userId };
        const user = await collection.findOne(filter);
        return user;
    } catch (error) {
        console.error("Error getting user by ID:", error);
        throw error;
    }
}

/**
 * Update the profile fields a user is allowed to manage themselves.
 * Identity and role fields remain managed by IAM and are intentionally not
 * accepted here.
 *
 * @param {Object} user - Authenticated user from the session
 * @param {Object} profile - Editable profile fields
 * @returns {Promise<Object|null>} Updated user document
 */
async function updateUserProfile(user, profile) {
    try {
        const db = await databaseService.connect();
        const collection = db.collection("grasp_user");
        const { ObjectId } = require('mongodb');

        const userId = user?._id || user?.id;
        const filter = userId && ObjectId.isValid(String(userId))
            ? { _id: new ObjectId(String(userId)) }
            : { puid: user?.puid };

        if (!filter.puid && !filter._id) {
            throw new Error("Authenticated user identity is required");
        }

        await collection.updateOne(
            filter,
            {
                $set: {
                    displayName: profile.displayName,
                    email: profile.email,
                    updatedAt: new Date(),
                },
            }
        );

        return collection.findOne(filter);
    } catch (error) {
        console.error("Error updating user profile:", error);
        throw error;
    }
}

/**
 * Normalize an affiliation value to an array. Stored shape varies:
 * SAML logins persist a comma-separated string, roster syncs an array.
 * @param {string|string[]|undefined} affiliation
 * @returns {string[]}
 */
function normalizeAffiliations(affiliation) {
    if (!affiliation) return [];
    return Array.isArray(affiliation)
        ? [...affiliation]
        : String(affiliation).split(',').map((a) => a.trim()).filter(Boolean);
}

/**
 * Grant the staff affiliation as part of a TA promotion. The student
 * affiliation is untouched, and staffViaTaPromotion records that the staff
 * affiliation was granted by us (not by SAML), so demotion knows it is safe
 * to remove it again.
 *
 * A user whose staff affiliation came from SAML already has everything the
 * staff-tier route mounts need, so nothing is granted and — crucially — the
 * promotion marker is NOT set: demoting them later must leave their genuine
 * affiliation alone. Their TA designation lives on the membership only.
 * @param {string|ObjectId} userId - User ID
 */
async function grantPromotedStaffAffiliation(userId) {
    try {
        const db = await databaseService.connect();
        const { ObjectId } = require('mongodb');
        const collection = db.collection("grasp_user");
        const idObj = typeof userId === 'string' && ObjectId.isValid(userId)
            ? new ObjectId(userId)
            : userId;
        // affiliation may be stored as a comma-separated string (SAML login)
        // or an array (roster sync); normalize to an array before writing —
        // $addToSet throws on non-array fields.
        const user = await collection.findOne({ _id: idObj });
        if (!user) return null;
        const affiliations = normalizeAffiliations(user.affiliation);
        const staffFromSaml = affiliations.includes('staff') && !user.staffViaTaPromotion;
        if (staffFromSaml) return null;
        if (!affiliations.includes('staff')) affiliations.push('staff');
        return collection.updateOne(
            { _id: idObj },
            {
                $set: {
                    affiliation: affiliations,
                    staffViaTaPromotion: true,
                    updatedAt: new Date(),
                },
            }
        );
    } catch (error) {
        console.error("Error granting promoted staff affiliation:", error);
        throw error;
    }
}

/**
 * Remove the staff affiliation that was granted by a TA promotion. Only used
 * when the user is no longer a TA in any course; never called for users whose
 * staff affiliation came from SAML.
 * @param {string|ObjectId} userId - User ID
 */
async function revokePromotedStaffAffiliation(userId) {
    try {
        const db = await databaseService.connect();
        const { ObjectId } = require('mongodb');
        const collection = db.collection("grasp_user");
        const idObj = typeof userId === 'string' && ObjectId.isValid(userId)
            ? new ObjectId(userId)
            : userId;
        const user = await collection.findOne({ _id: idObj });
        if (!user) return null;
        const affiliations = normalizeAffiliations(user.affiliation)
            .filter((affiliation) => affiliation !== 'staff');
        return collection.updateOne(
            { _id: idObj },
            {
                $unset: { staffViaTaPromotion: '' },
                $set: { affiliation: affiliations, updatedAt: new Date() },
            }
        );
    } catch (error) {
        console.error("Error revoking promoted staff affiliation:", error);
        throw error;
    }
}

/**
 * Get user IDs that are in a specific course
 * @param {Object} db - Database connection
 * @param {string|ObjectId} courseId - Course ID
 * @returns {Promise<Array>} Array of user IDs in the course
 */
async function getUserIdsInCourse(db, courseId) {
    const userCourseCollection = db.collection("grasp_user_course");
    const { ObjectId } = require('mongodb');
    const courseIdObj = typeof courseId === 'string' ? new ObjectId(courseId) : courseId;
    
    const courseUserIds = await userCourseCollection.find({
        $or: [
            { courseId: courseIdObj },
            { courseId: courseId }
        ]
    }).toArray();
    
    return courseUserIds.map(uc => uc.userId);
}

/**
 * Filter out users that are in the course
 * @param {Array} users - Array of users to filter
 * @param {Array} userIdsInCourse - Array of user IDs in the course
 * @returns {Array} Users not in the course
 */
function filterUsersNotInCourse(users, userIdsInCourse) {
    return users.filter(user => {
        const userIdStr = user._id.toString();
        return !userIdsInCourse.some(id => {
            const idStr = id.toString ? id.toString() : String(id);
            return idStr === userIdStr;
        });
    });
}

/**
 * Get all staff users (non-faculty) that are not in a specific course
 * @param {string|ObjectId} courseId - Course ID
 * @returns {Promise<Array>} Array of staff users not in the course
 */
async function getStaffUsersNotInCourse(courseId) {
    try {
        const db = await databaseService.connect();
        const userCollection = db.collection("grasp_user");
        
        const userIdsInCourse = await getUserIdsInCourse(db, courseId);
        const allUsers = await userCollection.find({}).toArray();
        
        // Filter to get staff users (have staff affiliation but not faculty).
        // A promoted TA is excluded: their staff affiliation was granted by an
        // instructor for one specific course, so outside it they are a student —
        // the same rule resolveCourseRole applies. This keeps the two pickers a
        // partition, so getAllUsersNotInCourseHandler cannot list them twice.
        const staffUsers = allUsers.filter(user => {
            if (!user.affiliation) return false;
            if (user.staffViaTaPromotion) return false;

            const affiliations = Array.isArray(user.affiliation)
                ? user.affiliation
                : String(user.affiliation).split(',').map(a => a.trim());

            const hasStaff = affiliations.includes('staff');
            const hasFaculty = affiliations.includes('faculty');

            return hasStaff && !hasFaculty;
        });
        
        return filterUsersNotInCourse(staffUsers, userIdsInCourse);
    } catch (error) {
        console.error("Error getting staff users not in course:", error);
        throw error;
    }
}

/**
 * Get all students (affiliation includes 'student' or 'affiliate') that are not in a specific course
 * @param {string|ObjectId} courseId - Course ID
 * @returns {Promise<Array>} Array of students not in the course
 */
async function getStudentsNotInCourse(courseId) {
    try {
        const db = await databaseService.connect();
        const userCollection = db.collection("grasp_user");
        
        const userIdsInCourse = await getUserIdsInCourse(db, courseId);
        const allUsers = await userCollection.find({}).toArray();
        
        // Student if they have the student or affiliate affiliation and are not
        // faculty. The staff affiliation still excludes them — genuine SAML
        // staff are offered by getStaffUsersNotInCourse instead, so they stay
        // addable — but a promoted TA is a student everywhere except the one
        // course they were promoted in, which is why the flag overrides it.
        // Before this they were offered only under "staff", so adding one to a
        // second course as a learner meant picking them out of the wrong list.
        const students = allUsers.filter(user => {
            if (!user.affiliation) return false;

            const affiliations = Array.isArray(user.affiliation)
                ? user.affiliation
                : String(user.affiliation).split(',').map(a => a.trim());

            const hasStudent = affiliations.includes('student') || affiliations.includes('affiliate');
            const hasStaff = affiliations.includes('staff') && !user.staffViaTaPromotion;
            const hasFaculty = affiliations.includes('faculty');

            return hasStudent && !hasStaff && !hasFaculty;
        });
        
        return filterUsersNotInCourse(students, userIdsInCourse);
    } catch (error) {
        console.error("Error getting students not in course:", error);
        throw error;
    }
}

// Cap on search hits: the picker is for finding one known person by email or
// name, not for browsing the user base.
const SEARCH_RESULT_LIMIT = 10;

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Both shapes an id may be stored under in grasp_user_course (ObjectId from
 * the app, string from older writes), so $in/$nin filters catch either.
 */
function idForms(id) {
    const forms = [id];
    const asString = String(id);
    if (typeof id !== 'string') forms.push(asString);
    if (ObjectId.isValid(asString)) forms.push(new ObjectId(asString));
    return forms;
}

/**
 * How many courses each of the given users belongs to, keyed by string id.
 * Lets the picker point out accounts that are not in any course yet — the
 * "signed in but has no role anywhere" guests issue #115 is about.
 */
async function countMembershipsByUser(db, userIds) {
    const counts = new Map();
    if (!userIds.length) return counts;
    const rows = await db.collection("grasp_user_course").aggregate([
        { $match: { userId: { $in: userIds.flatMap(idForms) } } },
        { $group: { _id: { $toString: "$userId" }, count: { $sum: 1 } } },
    ]).toArray();
    for (const row of rows) counts.set(row._id, row.count);
    return counts;
}

/**
 * Find accounts that are not in the course, by email or name. Search-only on
 * purpose: an instructor types the email or name of the person they mean and
 * gets a handful of matches, rather than a browsable list of every GRASP
 * account. Faculty filtering is left to the caller (it needs the admin
 * whitelist from utils/auth).
 * @param {string|ObjectId} courseId - Course whose members are excluded
 * @param {string} query - Case-insensitive substring of email, display name, or legal name
 * @param {{ limit?: number }} [options]
 * @returns {Promise<Array>} Users with a `courseCount` of their memberships
 */
async function searchUsersNotInCourse(courseId, query, { limit = SEARCH_RESULT_LIMIT } = {}) {
    try {
        const trimmed = String(query || '').trim();
        if (!trimmed) return [];

        const db = await databaseService.connect();
        const userCollection = db.collection("grasp_user");
        const userIdsInCourse = await getUserIdsInCourse(db, courseId);
        const pattern = new RegExp(escapeRegExp(trimmed), 'i');

        const matches = await userCollection
            .find(
                {
                    _id: { $nin: userIdsInCourse.flatMap(idForms) },
                    $or: [{ email: pattern }, { displayName: pattern }, { legalName: pattern }],
                },
                {
                    projection: {
                        _id: 1,
                        puid: 1,
                        email: 1,
                        displayName: 1,
                        legalName: 1,
                        affiliation: 1,
                        staffViaTaPromotion: 1,
                    },
                }
            )
            .sort({ legalName: 1, displayName: 1, email: 1 })
            .limit(Math.max(1, Math.min(Number(limit) || SEARCH_RESULT_LIMIT, 50)))
            .toArray();

        // Second line of defence for ids stored in a shape $nin did not catch.
        const candidates = filterUsersNotInCourse(matches, userIdsInCourse);
        const courseCounts = await countMembershipsByUser(db, candidates.map((u) => u._id));
        return candidates.map((user) => ({
            ...user,
            courseCount: courseCounts.get(String(user._id)) || 0,
        }));
    } catch (error) {
        console.error("Error searching users not in course:", error);
        throw error;
    }
}

module.exports = {
    createOrUpdateUser,
    getUserByPuid,
    getUserById,
    updateUserLegalName,
    updateUserNames,
    grantPromotedStaffAffiliation,
    revokePromotedStaffAffiliation,
    updateUserProfile,
    getStaffUsersNotInCourse,
    getStudentsNotInCourse,
    searchUsersNotInCourse,
};
