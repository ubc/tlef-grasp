const express = require('express');
const profileController = require('../controllers/profile');

const router = express.Router();

// A user may only update the profile belonging to their authenticated session.
router.put('/', profileController.updateProfileHandler);

module.exports = router;
