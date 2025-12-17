const databaseService = require('./database');

async function createOrUpdateUser(userData) {
    try {
        if (!userData.puid) {
            throw new Error("Puid is required");
        }

        const db = await databaseService.connect();

        const collection = db.collection("grasp_user");
        const user = {
            username: userData.username,
            puid: userData.puid,
            displayName: userData.displayName,
            email: userData.email,
            affiliation: userData.affiliation,
            updatedAt: new Date(),
        };

        // Use upsert to update existing user or create new one
        const result = await collection.updateOne(
            { puid: userData.puid },
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