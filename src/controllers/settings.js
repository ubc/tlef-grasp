const settingsService = require('../services/settings');
const { hasStaffAccessInCourse } = require('../utils/course-access');
const { assertCoInstructorPermission, isCourseManager, PERMISSION_KEYS } = require('../utils/co-instructor-permissions');
const { assertTaPermission, TA_SETTINGS_KEY } = require('../utils/ta-permissions');

/**
 * Get application settings handler
 */
const getSettingsHandler = async (req, res) => {
    try {
        const { courseId } = req.params;
        if (!courseId) {
            return res.status(400).json({ success: false, error: 'Course ID is required' });
        }
        if (!(await hasStaffAccessInCourse(req.user, courseId))) {
            return res.status(403).json({ success: false, error: 'Staff access is not granted in this course' });
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
        if (!(await hasStaffAccessInCourse(req.user, courseId))) {
            return res.status(403).json({ success: false, error: 'Staff access is not granted in this course' });
        }
        if (!(await assertCoInstructorPermission(req, res, courseId, PERMISSION_KEYS.SETTINGS))) return;
        // TAs may never edit course settings — this is where their own
        // permissions are managed, so allowing it would be self-escalation.
        if (!(await assertTaPermission(req, res, courseId, TA_SETTINGS_KEY))) return;
        const updateData = { ...req.body };
        // Only the course owner / app admins may change the co-instructor
        // permission map itself — stop a co-instructor with Settings access from
        // self-escalating. Other settings (prompts, bloom) are still saved.
        // Generation controls are course-owner-only for the same reason: they
        // change what every co-instructor's generation costs and whether
        // flagged questions are repaired. Checked once, since all three keys
        // share the requirement.
        const OWNER_ONLY_KEYS = [
            'coInstructorPermissions',
            'reasoningEffort',
            'autoFixEnabled',
        ];
        const ownerOnlyEdits = OWNER_ONLY_KEYS.filter((key) => key in updateData);
        if (ownerOnlyEdits.length > 0 && !(await isCourseManager(req.user, courseId))) {
            for (const key of ownerOnlyEdits) delete updateData[key];
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
