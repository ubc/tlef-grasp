const { isUserInCourse } = require('../services/user-course');
const { getObjectiveCourseId, getParentObjectives, getGranularObjectives, createObjective, updateObjective, deleteObjective } = require('../services/objective');
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

    if (!isUserInCourse(req.user.id, courseId)) {
      return res.status(403).json({ error: "User is not in course" });
    }

    const objectives = await getParentObjectives(courseId);
    res.json({
      success: true,
      objectives: objectives,
    });
  } catch (error) {
    console.error('Error fetching objectives:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch learning objectives',
    });
  }
};

const getGranularObjectivesHandler = async (req, res) => {
  try {
    const parentId = req.params.id;
    const { courseId } = req.query;

    if (!isUserInCourse(req.user.id, courseId)) {
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

    if (!isUserInCourse(req.user.id, courseId)) {
      return res.status(403).json({ error: "User is not in course" });
    }

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

    if (!isUserInCourse(req.user.id, courseId)) {
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

    if (!isUserInCourse(req.user.id, courseId)) {
      return res.status(403).json({ error: "User is not in course" });
    }

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
    const { name, granularObjectives, materialIds, courseId } = req.body;

    if (!isUserInCourse(req.user.id, courseId)) {
      return res.status(403).json({ error: "User is not in course" });
    }

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

const deleteObjectiveHandler = async (req, res) => {
  try {
    const objectiveId = req.params.id;

    // We still need to verify course permission for deletion.
    const courseId = await getObjectiveCourseId(objectiveId);

    if (courseId && !isUserInCourse(req.user.id, courseId)) {
      return res.status(403).json({ error: "User is not in course" });
    }

    await deleteObjective(objectiveId);

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
  getGranularObjectivesHandler,
  createObjectiveHandler,
  getObjectiveMaterials,
  updateObjectiveMaterials,
  updateObjectiveHandler,
  deleteObjectiveHandler
};
