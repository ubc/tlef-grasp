const databaseService = require("../services/database");

async function dbMiddleware(req, res, next) {
    try {
        req.db = await databaseService.connect();
        next();
    } catch (error) {
        next(error);
    }
}

module.exports = { dbMiddleware };