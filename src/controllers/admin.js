const settingsService = require('../services/settings');

/**
 * For each prompt, how many courses store their own copy instead of using the
 * default.
 */
const getPromptOverridesHandler = async (req, res) => {
    try {
        const counts = await settingsService.getStoredPromptCounts();
        res.json({ success: true, prompts: counts });
    } catch (error) {
        console.error('Error in getPromptOverridesHandler:', error);
        res.status(500).json({ success: false, error: 'Failed to count course prompts' });
    }
};

/**
 * Reset one prompt to the default in every course.
 */
const resetPromptForAllCoursesHandler = async (req, res) => {
    const { promptKey } = req.params;
    if (!Object.prototype.hasOwnProperty.call(settingsService.DEFAULT_PROMPTS, promptKey)) {
        return res.status(400).json({ success: false, error: `Unknown prompt: ${promptKey}` });
    }
    try {
        const resetCourses = await settingsService.resetPromptForAllCourses(promptKey);
        console.log(`🛠️ App administrator ${req.user?._id} reset prompt "${promptKey}" to default in ${resetCourses} course(s)`);
        res.json({ success: true, promptKey, resetCourses });
    } catch (error) {
        console.error('Error in resetPromptForAllCoursesHandler:', error);
        res.status(500).json({ success: false, error: 'Failed to reset the prompt' });
    }
};

module.exports = {
    getPromptOverridesHandler,
    resetPromptForAllCoursesHandler
};
