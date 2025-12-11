const databaseService = require('./database');

async function createOrUpdateUser(userData) {
    try {
        if (!userData.attributes.ubcEduCwlPuid) {
            throw new Error("Puid is required");
        }

        const db = await databaseService.connect();

        const collection = db.collection("grasp_user");
        const user = {
            username: userData.cwlLoginName,
            puid: userData.attributes.ubcEduCwlPuid,
            firstName: userData.givenName,
            lastName: userData.sn,
            email: userData.attributes.mail,
            affiliation: userData.attributes.eduPersonAffiliation,
            updatedAt: new Date(),
        };

        // Use upsert to update existing user or create new one
        const result = await collection.updateOne(
            { puid: userData.attributes.ubcEduCwlPuid },
            {
                $set: user,
                $setOnInsert: { registeredAt: new Date() }
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

module.exports = {
    createOrUpdateUser,
    getUserByPuid,
};