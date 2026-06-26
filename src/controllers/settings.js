const settingsService = require('../services/settings');
const { isUserInCourse } = require('../services/user-course');
const { assertCoInstructorPermission, isCourseManager, PERMISSION_KEYS } = require('../utils/co-instructor-permissions');

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
        if (!(await isUserInCourse(req.user.id || req.user._id, courseId))) {
            return res.status(403).json({ success: false, error: 'User is not in course' });
        }
        if (!(await assertCoInstructorPermission(req, res, courseId, PERMISSION_KEYS.SETTINGS))) return;
        const updateData = { ...req.body };
        // Only the course owner / app admins may change the co-instructor
        // permission map itself — stop a co-instructor with Settings access from
        // self-escalating. Other settings (prompts, bloom) are still saved.
        if ('coInstructorPermissions' in updateData && !(await isCourseManager(req.user, courseId))) {
            delete updateData.coInstructorPermissions;
        }
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
