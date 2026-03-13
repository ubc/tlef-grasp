const express = require('express');
const router = express.Router();
const settingsController = require('../controllers/settings');

/**
 * GET /api/settings
 * Get application settings
 */
router.get('/', settingsController.getSettingsHandler);

/**
 * PUT /api/settings
 * Update application settings
 */
router.put('/', express.json(), settingsController.updateSettingsHandler);

module.exports = router;
