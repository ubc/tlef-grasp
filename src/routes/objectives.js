const express = require('express');
const router = express.Router();
const objectiveService = require('../services/objective');
const objectiveMaterialService = require('../services/objective-material');
// Note: Authentication is handled at app level with ensureAuthenticatedAPI
// No need for route-level auth since app.use("/api/objectives", ensureAuthenticatedAPI, objectiveRoutes)

/**
 * GET /api/objectives
 * Get all parent learning objectives (parent = 0)
 */
router.get('/', async (req, res) => {
  try {
    const objectives = await objectiveService.getParentObjectives();
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
});

/**
 * GET /api/objectives/:id/granular
 * Get granular objectives for a parent objective
 */
router.get('/:id/granular', async (req, res) => {
  try {
    const parentId = req.params.id;
    // Convert string ID to ObjectId if needed
    const { ObjectId } = require('mongodb');
    const granularObjectives = await objectiveService.getGranularObjectives(
      ObjectId.isValid(parentId) ? new ObjectId(parentId) : parentId
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
});

/**
 * POST /api/objectives
 * Create a new learning objective with granular objectives
 * Body: { name: string, granularObjectives: Array<{text: string}>, materialIds: Array<string> }
 */
router.post('/', async (req, res) => {
  try {
    const { name, granularObjectives, materialIds } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Learning objective name is required',
      });
    }

    const result = await objectiveService.createObjective({
      name: name.trim(),
      granularObjectives: granularObjectives || [],
      materialIds: materialIds || [],
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
});

/**
 * GET /api/objectives/:id/materials
 * Get all materials associated with a learning objective
 */
router.get('/:id/materials', async (req, res) => {
  try {
    const objectiveId = req.params.id;
    const materials = await objectiveMaterialService.getMaterialsForObjective(objectiveId);
    
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
});

/**
 * PUT /api/objectives/:id/materials
 * Update material relationships for a learning objective
 * Body: { materialIds: Array<string> }
 */
router.put('/:id/materials', express.json(), async (req, res) => {
  try {
    const objectiveId = req.params.id;
    const { materialIds } = req.body;

    await objectiveMaterialService.updateObjectiveMaterialRelations(
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
});

/**
 * PUT /api/objectives/:id
 * Update a learning objective
 * Body: { name: string, granularObjectives: Array<{id?: string, text: string}>, materialIds: Array<string> }
 */
router.put('/:id', express.json(), async (req, res) => {
  try {
    const objectiveId = req.params.id;
    const { name, granularObjectives, materialIds } = req.body;

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
    if (materialIds !== undefined) {
      updateData.materialIds = materialIds;
    }

    const result = await objectiveService.updateObjective(objectiveId, updateData);

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
});

module.exports = router;
