const settingsService = require('../services/settings');

/**
 * Get application settings handler
 */
const getSettingsHandler = async (req, res) => {
    try {
        const settings = await settingsService.getSettings();
        res.json({
            success: true,
            settings
        });
    } catch (error) {
        console.error('Error in getSettingsHandler:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch settings'
        });
    }
};

/**
 * Update application settings handler
 */
const updateSettingsHandler = async (req, res) => {
    try {
        const updateData = req.body;
        const result = await settingsService.updateSettings(updateData);
        res.json({
            success: true,
            settings: result
        });
    } catch (error) {
        console.error('Error in updateSettingsHandler:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update settings'
        });
    }
};

module.exports = {
    getSettingsHandler,
    updateSettingsHandler
};
