const express = require('express');
const router = express.Router();
const objectiveController = require('../controllers/objective');

// Note: Authentication is handled at app level with ensureAuthenticatedAPI
// No need for route-level auth since app.use("/api/objective", ensureAuthenticatedAPI, objectiveRoutes)

/**
 * GET /api/objective
 * Get all parent learning objectives (parent = 0) for a specific course
 * Query params: courseId (required)
 */
router.get('/', objectiveController.getAllObjectives);

/**
 * GET /api/objective/:id/granular
 * Get granular objectives for a parent objective
 * Query params: courseId (optional, will inherit from parent if not provided)
 */
router.get('/:id/granular', objectiveController.getGranularObjectivesHandler);

/**
 * POST /api/objective
 * Create a new learning objective with granular objectives
 * Body: { name: string, granularObjectives: Array<{text: string}>, materialIds: Array<string> }
 */
router.post('/', express.json(), objectiveController.createObjectiveHandler);

/**
 * GET /api/objective/:id/materials
 * Get all materials associated with a learning objective
 */
router.get('/:id/materials', objectiveController.getObjectiveMaterials);

/**
 * PUT /api/objective/:id/materials
 * Update material relationships for a learning objective
 * Body: { materialIds: Array<string> }
 */
router.put('/:id/materials', express.json(), objectiveController.updateObjectiveMaterials);

/**
 * PUT /api/objective/:id
 * Update a learning objective
 * Body: { name: string, granularObjectives: Array<{id?: string, text: string}>, materialIds: Array<string> }
 */
router.put('/:id', express.json(), objectiveController.updateObjectiveHandler);

module.exports = router;
