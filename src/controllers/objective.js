const { hasStaffAccessInCourse } = require('../utils/course-access');
const { assertCoInstructorPermission, PERMISSION_KEYS } = require('../utils/co-instructor-permissions');
const { assertTaPermission, TA_PERMISSION_KEYS } = require("../utils/ta-permissions");
const { getObjectiveCourseId, getParentObjectives, getDetailedObjectives, getGranularObjectives, createObjective, updateObjective, getObjectiveDeletionImpact, deleteObjective } = require('../services/objective');
const { updateObjectiveMaterialRelations, getMaterialsForObjective } = require('../services/objective-material');

const getAllObjectives = async (req, res) => {
  try {
    const { courseId } = req.query;

    if (!courseId) {
      return res.status(400).json({
        success: false,
        error: 'Course ID is required',
      });
    }

    if (!(await hasStaffAccessInCourse(req.user, courseId))) {
      return res.status(403).json({ error: "User is not in course" });
    }

    const objectives = await getParentObjectives(courseId);
    
    // Populate materialIds for each objective
    const populatedObjectives = await Promise.all(objectives.map(async (obj) => {
      try {
        const materials = await getMaterialsForObjective(obj._id);
        const materialIds = materials.map(m => m.sourceId || m._id.toString());
        return {
          ...obj,
          materialIds
        };
      } catch (err) {
        console.error(`Error populating materials for objective ${obj._id}:`, err);
        return {
          ...obj,
          materialIds: []
        };
      }
    }));

    res.json({
      success: true,
      objectives: populatedObjectives,
    });
  } catch (error) {
    console.error('Error fetching objectives:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch learning objectives',
    });
  }
};

// Objectives with granular sub-objectives and material sourceIds in one
// response (replaces two follow-up requests per objective).
const getDetailedObjectivesHandler = async (req, res) => {
  try {
    const { courseId } = req.query;

    if (!courseId) {
      return res.status(400).json({
        success: false,
        error: 'Course ID is required',
      });
    }

    if (!(await hasStaffAccessInCourse(req.user, courseId))) {
      return res.status(403).json({ error: "User is not in course" });
    }

    const objectives = await getDetailedObjectives(courseId);
    res.json({ success: true, objectives });
  } catch (error) {
    console.error('Error fetching detailed objectives:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch detailed learning objectives',
    });
  }
};

const getGranularObjectivesHandler = async (req, res) => {
  try {
    const parentId = req.params.id;
    const { courseId } = req.query;

    if (!(await hasStaffAccessInCourse(req.user, courseId))) {
      return res.status(403).json({ error: "User is not in course" });
    }
  
    // Convert string ID to ObjectId if needed
    const { ObjectId } = require('mongodb');
    const granularObjectives = await getGranularObjectives(
      ObjectId.isValid(parentId) ? new ObjectId(parentId) : parentId,
      courseId
    );
    res.json({
      success: true,
      objectives: granularObjectives,
    });
  } catch (error) {
    console.error('Error fetching granular objectives:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch granular objectives',
    });
  }
};

const createObjectiveHandler = async (req, res) => {
  try {
    const { name, granularObjectives, materialIds, courseId } = req.body;

    if (!(await hasStaffAccessInCourse(req.user, courseId))) {
      return res.status(403).json({ error: "User is not in course" });
    }
    if (!(await assertCoInstructorPermission(req, res, courseId, PERMISSION_KEYS.QUESTION_GENERATION))) return;
    if (!(await assertTaPermission(req, res, courseId, TA_PERMISSION_KEYS.QUESTION_GENERATION))) return;

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Learning objective name is required',
      });
    }

    if (!courseId) {
      return res.status(400).json({
        success: false,
        error: 'Course ID is required',
      });
    }

    const result = await createObjective({
      name: name.trim(),
      granularObjectives: granularObjectives || [],
      courseId: courseId,
    });

    // Persist material relationships if provided
    if (materialIds && Array.isArray(materialIds) && materialIds.length > 0) {
      await updateObjectiveMaterialRelations(result.parent._id.toString(), materialIds);
    }

    res.json({
      success: true,
      objective: result.parent,
      granularObjectives: result.granular,
    });
  } catch (error) {
    console.error('Error creating objective:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create learning objective',
    });
  }
};

const getObjectiveMaterials = async (req, res) => {
  try {
    const objectiveId = req.params.id;
    const materials = await getMaterialsForObjective(objectiveId);

    const courseId = await getObjectiveCourseId(objectiveId);

    if (!(await hasStaffAccessInCourse(req.user, courseId))) {
      return res.status(403).json({ error: "User is not in course" });
    }

    res.json({
      success: true,
      materials: materials,
    });
  } catch (error) {
    console.error('Error fetching materials for objective:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch materials for learning objective',
    });
  }
};

const updateObjectiveMaterials = async (req, res) => {
  try {
    const objectiveId = req.params.id;
    const { materialIds } = req.body;

    const courseId = await getObjectiveCourseId(objectiveId);

    if (!(await hasStaffAccessInCourse(req.user, courseId))) {
      return res.status(403).json({ error: "User is not in course" });
    }
    if (!(await assertCoInstructorPermission(req, res, courseId, PERMISSION_KEYS.QUESTION_GENERATION))) return;
    if (!(await assertTaPermission(req, res, courseId, TA_PERMISSION_KEYS.QUESTION_GENERATION))) return;

    await updateObjectiveMaterialRelations(
      objectiveId,
      materialIds || []
    );

    res.json({
      success: true,
      message: 'Material relationships updated successfully',
    });
  } catch (error) {
    console.error('Error updating material relationships:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update material relationships',
    });
  }
};

const updateObjectiveHandler = async (req, res) => {
  try {
    const objectiveId = req.params.id;
    const { name, granularObjectives, materialIds, courseId, questionAction } = req.body;

    if (!(await hasStaffAccessInCourse(req.user, courseId))) {
      return res.status(403).json({ error: "User is not in course" });
    }
    if (!(await assertCoInstructorPermission(req, res, courseId, PERMISSION_KEYS.QUESTION_GENERATION))) return;
    if (!(await assertTaPermission(req, res, courseId, TA_PERMISSION_KEYS.QUESTION_GENERATION))) return;

    // Name is required if provided
    if (name !== undefined && (!name || !name.trim())) {
      return res.status(400).json({
        success: false,
        error: 'Learning objective name cannot be empty',
      });
    }

    const updateData = {};
    if (name !== undefined) {
      updateData.name = name.trim();
    }
    if (granularObjectives !== undefined) {
      updateData.granularObjectives = granularObjectives;
    }
    if (courseId !== undefined) {
      updateData.courseId = courseId;
    }
    if (questionAction === 'delete' || questionAction === 'keep') {
      updateData.questionAction = questionAction;
    }

    const result = await updateObjective(objectiveId, updateData);

    res.json({
      success: true,
      objective: result,
      granularObjectives: result.granularObjectives || [],
    });
  } catch (error) {
    console.error('Error updating objective:', error);
    if (error.message === 'Objective not found') {
      return res.status(404).json({
        success: false,
        error: 'Learning objective not found',
      });
    }
    res.status(500).json({
      success: false,
      error: 'Failed to update learning objective',
    });
  }
};

/**
 * GET /api/objective/:id/deletion-impact
 * Report how many questions (and which quizzes) would be affected by deleting
 * this learning objective, so the client can prompt the instructor first.
 */
const getObjectiveDeletionImpactHandler = async (req, res) => {
  try {
    const objectiveId = req.params.id;
    const courseId = await getObjectiveCourseId(objectiveId);

    if (courseId && !(await hasStaffAccessInCourse(req.user, courseId))) {
      return res.status(403).json({ error: "User is not in course" });
    }

    const impact = await getObjectiveDeletionImpact(objectiveId);
    res.json({ success: true, ...impact });
  } catch (error) {
    console.error('Error computing objective deletion impact:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to compute deletion impact',
    });
  }
};

const deleteObjectiveHandler = async (req, res) => {
  try {
    const objectiveId = req.params.id;
    // Instructor's explicit choice for linked questions: 'delete' or 'keep'.
    const questionAction = req.query.questionAction === 'delete' ? 'delete' : 'keep';

    // We still need to verify course permission for deletion.
    const courseId = await getObjectiveCourseId(objectiveId);

    if (courseId && !(await hasStaffAccessInCourse(req.user, courseId))) {
      return res.status(403).json({ error: "User is not in course" });
    }
    if (courseId && !(await assertCoInstructorPermission(req, res, courseId, PERMISSION_KEYS.QUESTION_GENERATION))) return;
    if (courseId && !(await assertTaPermission(req, res, courseId, TA_PERMISSION_KEYS.QUESTION_GENERATION))) return;

    await deleteObjective(objectiveId, questionAction);

    res.json({
      success: true,
      message: 'Learning objective deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting objective:', error);
    if (error.message === 'Objective not found') {
      return res.status(404).json({
        success: false,
        error: 'Learning objective not found',
      });
    }
    res.status(500).json({
      success: false,
      error: 'Failed to delete learning objective',
    });
  }
};

module.exports = {
  getAllObjectives,
  getDetailedObjectivesHandler,
  getGranularObjectivesHandler,
  createObjectiveHandler,
  getObjectiveMaterials,
  updateObjectiveMaterials,
  updateObjectiveHandler,
  getObjectiveDeletionImpactHandler,
  deleteObjectiveHandler
};
