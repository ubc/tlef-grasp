// Grade CSV download for one section (issue #126). Instructors and app
// administrators only: the routes require the faculty role, so TAs (staff) and
// students are refused before these handlers run. Within a course, the owner
// and administrators may export any section and other instructors only the
// sections they own, the same scoping as Quiz Scores.

const { ObjectId } = require('mongodb');
const { getSectionsForViewer } = require('../services/course-section');
const { getCourseById } = require('../services/course');
const gradeExportService = require('../services/grade-export');

// The requested section, if this viewer may export it; otherwise the error
// response has been sent and null is returned.
async function resolveSection(req, res) {
  const { courseId } = req.params;
  const sectionId = typeof req.query.sectionId === 'string' ? req.query.sectionId : '';
  if (!ObjectId.isValid(courseId) || !sectionId) {
    res.status(400).json({ success: false, error: 'A course and a section are required' });
    return null;
  }
  const { sections } = await getSectionsForViewer(courseId, req.user);
  const section = sections.find((s) => s.sectionId === sectionId);
  if (!section) {
    res.status(403).json({
      success: false,
      error: 'You can only export grades for sections you own',
    });
    return null;
  }
  return section;
}

function fileSafe(text) {
  return String(text || '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * GET /api/quiz/course/:courseId/grade-export?sectionId=
 * The section's quizzes for the download dialog.
 */
const getGradeExportOverviewHandler = async (req, res) => {
  try {
    const section = await resolveSection(req, res);
    if (!section) return;
    const overview = await gradeExportService.getSectionGradeOverview(req.params.courseId, section);
    res.json({ success: true, ...overview });
  } catch (error) {
    console.error('Error loading the grade export:', error);
    res.status(500).json({ success: false, error: 'Failed to load the grade export' });
  }
};

/**
 * GET /api/quiz/course/:courseId/grade-export/csv?sectionId=&quizIds=a,b[&questionsCorrect=1]
 * The CSV file; questionsCorrect adds each quiz's "4 of 5" column.
 */
const downloadGradeCsvHandler = async (req, res) => {
  try {
    const section = await resolveSection(req, res);
    if (!section) return;
    const quizIds = String(req.query.quizIds || '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    if (quizIds.length === 0) {
      return res.status(400).json({ success: false, error: 'Choose at least one quiz' });
    }

    const { courseId } = req.params;
    const { csv, quizCount } = await gradeExportService.buildSectionGradeCsv(courseId, section, quizIds, {
      includeQuestionsCorrect: req.query.questionsCorrect === '1',
    });
    if (quizCount === 0) {
      return res.status(400).json({
        success: false,
        error: 'None of the chosen quizzes are published and scheduled for this section',
      });
    }

    const course = await getCourseById(courseId);
    const date = new Date().toISOString().slice(0, 10);
    const name = ['grasp-grades', course?.courseCode, section.sectionNumber || section.sectionId, date]
      .map(fileSafe)
      .filter(Boolean)
      .join('-');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}.csv"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(csv);
  } catch (error) {
    console.error('Error exporting grades:', error);
    res.status(500).json({ success: false, error: 'Failed to export grades' });
  }
};

module.exports = {
  downloadGradeCsvHandler,
  getGradeExportOverviewHandler,
};
