const express = require('express');
const adminController = require('../controllers/admin');

const router = express.Router();

// Mounted behind requireAppAdministrator: these act on every course at once.
router.get('/prompts', adminController.getPromptOverridesHandler);
router.post('/prompts/:promptKey/reset', adminController.resetPromptForAllCoursesHandler);

module.exports = router;
