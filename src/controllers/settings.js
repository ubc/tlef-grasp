const settingsService = require('../services/settings');

/**
 * Get application settings handler
 */
const getSettingsHandler = async (req, res) => {
    try {
        const { courseId } = req.params;
        if (!courseId) {
            return res.status(400).json({ success: false, error: 'Course ID is required' });
        }
        const settings = await settingsService.getSettings(courseId);
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
        const { courseId } = req.params;
        if (!courseId) {
            return res.status(400).json({ success: false, error: 'Course ID is required' });
        }
        const updateData = req.body;
        const result = await settingsService.updateSettings(courseId, updateData);
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

/**
 * Get default application settings (prompts)
 */
const getDefaultSettingsHandler = async (req, res) => {
    try {
        const { DEFAULT_PROMPTS } = require('../constants/app-constants');
        res.json({
            success: true,
            defaults: {
                prompts: DEFAULT_PROMPTS
            }
        });
    } catch (error) {
        console.error('Error in getDefaultSettingsHandler:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch default settings'
        });
    }
};

module.exports = {
    getSettingsHandler,
    updateSettingsHandler,
    getDefaultSettingsHandler
};
