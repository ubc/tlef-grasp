const express = require('express');
const router = express.Router();
const ubcApiService = require('../services/ubcApiService');

// GET /api/ubc/campuses
router.get('/campuses', async (req, res) => {
  try {
    const campuses = await ubcApiService.getCampuses();
    res.json({ success: true, data: campuses });
  } catch (error) {
    console.error('Error fetching campuses:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch campuses' });
  }
});

// GET /api/ubc/academic-periods
router.get('/academic-periods', async (req, res) => {
  try {
    const { campus } = req.query;
    const periods = await ubcApiService.getAcademicPeriods(campus);
    res.json({ success: true, data: periods });
  } catch (error) {
    console.error('Error fetching academic periods:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch academic periods' });
  }
});

// GET /api/ubc/instructor-sections
router.get('/instructor-sections', async (req, res) => {
  try {
    const { academicPeriod } = req.query;
    if (!academicPeriod) {
      return res.status(400).json({ success: false, error: 'academicPeriod is required' });
    }

    const puid = req.user?.puid;
    if (!puid) {
      return res.status(401).json({ success: false, error: 'User PUID not found in session' });
    }

    const sections = await ubcApiService.getInstructorSections(puid, academicPeriod);
    res.json({ success: true, data: sections });
  } catch (error) {
    console.error('Error fetching instructor sections:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch instructor sections' });
  }
});

module.exports = router;
