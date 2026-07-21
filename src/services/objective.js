const databaseService = require('./database');
const objectiveMaterialService = require('./objective-material');
const questionService = require('./question');
const { ObjectId } = require('mongodb');

/**
 * Get all parent learning objectives (parent = 0) for a specific course
 * @param {string} courseId - The course ID to filter by
 */
const getParentObjectives = async (courseId) => {
  try {
    const db = await databaseService.connect();
    const collection = db.collection('grasp_objective');
    
    // Build query with courseId filter
    const query = { parent: 0 };
    if (courseId) {
      const courseIdObj = ObjectId.isValid(courseId) ? new ObjectId(courseId) : courseId;
      query.courseId = courseIdObj;
    }
    
    const objectives = await collection.find(query).toArray();
    return objectives;
  } catch (error) {
    console.error('Error getting parent objectives:', error);
    throw error;
  }
};

/**
 * Get all parent objectives for a course with their granular objectives and
 * associated material sourceIds, using batched queries (no per-objective lookups).
 * @param {string} courseId - The course ID
 * @returns {Promise<Array>} [{ ...parent, granularObjectives: [], materialSourceIds: [] }]
 */
const getDetailedObjectives = async (courseId) => {
  try {
    const db = await databaseService.connect();
    const objectiveCollection = db.collection('grasp_objective');
    const courseIdObj = ObjectId.isValid(courseId) ? new ObjectId(courseId) : courseId;

    const parents = await objectiveCollection
      .find({ parent: 0, courseId: courseIdObj })
      .toArray();
    if (parents.length === 0) return [];

    const parentIds = parents.map((p) => p._id);

    const [granulars, relationships] = await Promise.all([
      objectiveCollection
        .find({ parent: { $in: parentIds }, courseId: courseIdObj })
        .toArray(),
      db
        .collection('grasp_objective_material')
        .find({ objectiveId: { $in: parentIds } })
        .toArray(),
    ]);

    const materialIds = [...new Set(relationships.map((r) => String(r.materialId)))]
      .map((id) => new ObjectId(id));
    const materials = materialIds.length
      ? await db.collection('grasp_material').find({ _id: { $in: materialIds } }).toArray()
      : [];
    const sourceIdByMaterialId = new Map(
      materials.map((m) => [String(m._id), m.sourceId || String(m._id)])
    );

    const granularsByParent = new Map();
    granulars.forEach((g) => {
      const key = String(g.parent);
      if (!granularsByParent.has(key)) granularsByParent.set(key, []);
      granularsByParent.get(key).push(g);
    });

    const sourceIdsByObjective = new Map();
    relationships.forEach((r) => {
      const key = String(r.objectiveId);
      const sourceId = sourceIdByMaterialId.get(String(r.materialId));
      if (!sourceId) return;
      if (!sourceIdsByObjective.has(key)) sourceIdsByObjective.set(key, []);
      sourceIdsByObjective.get(key).push(sourceId);
    });

    return parents.map((parent) => ({
      ...parent,
      granularObjectives: granularsByParent.get(String(parent._id)) || [],
      materialSourceIds: sourceIdsByObjective.get(String(parent._id)) || [],
    }));
  } catch (error) {
    console.error('Error getting detailed objectives:', error);
    throw error;
  }
};

/**
 * Get all granular objectives for a parent objective
 * @param {string|ObjectId} parentId - The parent objective ID
 * @param {string} courseId - Optional course ID to filter by (for additional validation)
 */
const getGranularObjectives = async (parentId, courseId = null) => {
  try {
    const db = await databaseService.connect();
    const collection = db.collection('grasp_objective');
    
    // Convert parentId to ObjectId if needed
    const id = ObjectId.isValid(parentId) ? new ObjectId(parentId) : parentId;
    
    // Build query
    const query = { parent: id };
    
    // If courseId is provided, filter by it (granular objectives inherit courseId from parent)
    if (courseId) {
      const courseIdObj = ObjectId.isValid(courseId) ? new ObjectId(courseId) : courseId;
      query.courseId = courseIdObj;
    }
    
    const objectives = await collection.find(query).toArray();
    return objectives;
  } catch (error) {
    console.error('Error getting granular objectives:', error);
    throw error;
  }
};

/**
 * Create a new learning objective with granular objectives
 * @param {Object} objectiveData - { name: string, granularObjectives: Array<{text: string}>, materialIds: Array<string> }
 */
const createObjective = async (objectiveData) => {
  try {
    const db = await databaseService.connect();
    const collection = db.collection('grasp_objective');
    
    // Convert courseId to ObjectId if it's a string
    const courseIdObj = ObjectId.isValid(objectiveData.courseId) 
      ? new ObjectId(objectiveData.courseId) 
      : objectiveData.courseId;
    
    // Create parent objective (no materialIds stored here)
    const parentObjective = {
      name: objectiveData.name,
      parent: 0,
      courseId: courseIdObj,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    
    const parentResult = await collection.insertOne(parentObjective);
    const parentId = parentResult.insertedId;
    
    // Create granular objectives if provided
    let createdGranular = [];
    if (objectiveData.granularObjectives && objectiveData.granularObjectives.length > 0) {
      const granularObjectives = objectiveData.granularObjectives.map((granular) => ({
        name: granular.text || granular.name,
        bloomTaxonomies: granular.bloomTaxonomies || [],
        questionCount: granular.questionCount || 2,
        parent: parentId,
        courseId: courseIdObj,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));
      
      if (granularObjectives.length > 0) {
        const result = await collection.insertMany(granularObjectives);
        // Get the created granular objectives
        const granularIds = Object.values(result.insertedIds);
        createdGranular = await collection.find({ _id: { $in: granularIds } }).toArray();
      }
    }
    
    // Return the created parent objective with its granular objectives
    // Note: Materials are now handled separately
    
    // Return the created parent objective with its granular objectives
    const createdParent = await collection.findOne({ _id: parentId });
    
    return {
      parent: createdParent,
      granular: createdGranular,
    };
  } catch (error) {
    console.error('Error creating objective:', error);
    throw error;
  }
};

/**
 * Get a single objective by ID
 * @param {string|ObjectId} objectiveId - The objective ID
 * @param {string} courseId - Optional course ID to verify the objective belongs to the course
 */
const getObjectiveById = async (objectiveId, courseId = null) => {
  try {
    const db = await databaseService.connect();
    const collection = db.collection('grasp_objective');
    const { ObjectId } = require('mongodb');
    
    // Convert string ID to ObjectId if needed
    const id = ObjectId.isValid(objectiveId) ? new ObjectId(objectiveId) : objectiveId;
    
    // Build query
    const query = { _id: id };
    if (courseId) {
      query.courseId = ObjectId.isValid(courseId) ? new ObjectId(courseId) : courseId;
    }
    
    const objective = await collection.findOne(query);
    return objective;
  } catch (error) {
    console.error('Error getting objective by ID:', error);
    throw error;
  }
};

/**
 * Get a learning objective with its associated materials
 * @param {string|ObjectId} objectiveId - The objective ID
 * @param {string} courseId - Optional course ID to verify the objective belongs to the course
 */
const getObjectiveWithMaterials = async (objectiveId, courseId = null) => {
  try {
    const objective = await getObjectiveById(objectiveId, courseId);
    if (!objective) {
      return null;
    }
    
    // If it's a granular objective (parent is not 0), resolve materials from its parent objective
    const targetId = (objective.parent && objective.parent !== 0 && objective.parent !== '0')
      ? objective.parent
      : objective._id;
      
    const materials = await objectiveMaterialService.getMaterialsForObjective(targetId);
    
    return {
      ...objective,
      materials: materials,
    };
  } catch (error) {
    console.error('Error getting objective with materials:', error);
    throw error;
  }
};

/**
 * Update a learning objective
 * @param {string|ObjectId} objectiveId - The learning objective ID
 * @param {Object} updateData - { name: string, granularObjectives: Array<{id?: string, text: string}>, materialIds: Array<string> }
 */
const updateObjective = async (objectiveId, updateData) => {
  try {
    const db = await databaseService.connect();
    const collection = db.collection('grasp_objective');
    const { ObjectId } = require('mongodb');
    
    // Convert string ID to ObjectId if needed
    const id = ObjectId.isValid(objectiveId) ? new ObjectId(objectiveId) : objectiveId;
    
    // Verify objective exists
    const existingObjective = await collection.findOne({ _id: id });
    if (!existingObjective) {
      throw new Error('Objective not found');
    }
    
    // Build update object for parent objective
    const update = {
      updatedAt: new Date(),
    };
    
    if (updateData.name !== undefined) {
      update.name = updateData.name.trim();
    }
    if (updateData.courseId !== undefined) {
      // Convert courseId to ObjectId if it's a string
      update.courseId = ObjectId.isValid(updateData.courseId) 
        ? new ObjectId(updateData.courseId) 
        : updateData.courseId;
    }
    
    // Update parent objective name if provided
    if (updateData.name !== undefined) {
      await collection.updateOne(
        { _id: id },
        { $set: update }
      );
    }
    
    // Handle granular objectives update if provided
    if (updateData.granularObjectives !== undefined) {
      // Get existing granular objectives
      const existingGranular = await collection.find({ parent: id }).toArray();
      const existingGranularIds = existingGranular.map(g => g._id.toString());
      
      // Get courseId from parent objective if not provided in updateData
      let courseIdForGranular = update.courseId;
      if (!courseIdForGranular) {
        const existingParent = await collection.findOne({ _id: id });
        courseIdForGranular = existingParent?.courseId;
        // Ensure courseId is an ObjectId if it came from existing parent
        if (courseIdForGranular && ObjectId.isValid(courseIdForGranular)) {
          courseIdForGranular = new ObjectId(courseIdForGranular);
        }
      }
      
      // Process granular objectives
      const granularToKeep = [];
      const granularToCreate = [];
      const granularToUpdate = [];
      
      updateData.granularObjectives.forEach((granular) => {
        // The client sends existing granulars straight from the API, so their
        // identifier may arrive as `_id` (raw Mongo doc) or `id`. Accept either
        // — otherwise every kept granular looks "new" and the diff below deletes
        // and recreates them all, orphaning their questions. (Issue #82)
        const existingId = granular.id || granular._id;
        if (existingId && ObjectId.isValid(existingId)) {
          // Existing granular objective - update it
          const granularId = new ObjectId(existingId);
          granularToKeep.push(granularId.toString());
          granularToUpdate.push({
            id: granularId,
            name: granular.text || granular.name,
            bloomTaxonomies: granular.bloomTaxonomies || [],
            questionCount: granular.questionCount || 2,
          });
        } else {
          // New granular objective - create it
          granularToCreate.push({
            name: granular.text || granular.name,
            bloomTaxonomies: granular.bloomTaxonomies || [],
            questionCount: granular.questionCount || 2,
            parent: id,
            courseId: courseIdForGranular,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        }
      });
      
      // Update existing granular objectives
      const updatePromises = granularToUpdate.map(granular => {
        const update = {
          name: granular.name,
          bloomTaxonomies: granular.bloomTaxonomies,
          questionCount: granular.questionCount,
          updatedAt: new Date()
        };
        // Update courseId if provided
        if (courseIdForGranular) {
          update.courseId = courseIdForGranular;
        }
        return collection.updateOne(
          { _id: granular.id, parent: id },
          { $set: update }
        );
      });
      await Promise.all(updatePromises);
      
      // Create new granular objectives
      if (granularToCreate.length > 0) {
        await collection.insertMany(granularToCreate);
      }
      
      // Delete granular objectives that are no longer in the list
      const granularToDelete = existingGranularIds.filter(id => !granularToKeep.includes(id));
      if (granularToDelete.length > 0) {
        const deleteIds = granularToDelete.map(id => ObjectId.isValid(id) ? new ObjectId(id) : id);
        await collection.deleteMany({ _id: { $in: deleteIds }, parent: id });
        // Questions generated from the removed granular objectives would be left
        // pointing at nothing. Honor the instructor's explicit choice: either
        // delete them, or orphan them (kept as Draft) and pull them from quizzes.
        if (updateData.questionAction === 'delete') {
          await questionService.deleteQuestionsByObjectiveIds(deleteIds);
        } else {
          await questionService.orphanQuestionsByObjectiveIds(deleteIds);
        }
      }
    }
    
    // Fetch and return the updated objective with its granular objectives
    // Note: Materials are now handled separately
    const updatedObjective = await collection.findOne({ _id: id });
    const updatedGranular = await collection.find({ parent: id }).toArray();
    
    return {
      ...updatedObjective,
      granularObjectives: updatedGranular,
    };
  } catch (error) {
    console.error('Error updating objective:', error);
    throw error;
  }
};

/**
 * Summarize the questions that would be affected by deleting a learning
 * objective, so the UI can prompt the instructor before the destructive delete.
 * @param {string|ObjectId} objectiveId - The learning objective ID
 * @returns {Promise<{questionCount: number, approvedCount: number, inQuizCount: number, quizNames: string[]}>}
 */
const getObjectiveDeletionImpact = async (objectiveId) => {
  const db = await databaseService.connect();
  const collection = db.collection('grasp_objective');
  const id = ObjectId.isValid(objectiveId) ? new ObjectId(objectiveId) : objectiveId;

  const granulars = await collection
    .find({ parent: id }, { projection: { _id: 1 } })
    .toArray();

  return questionService.getLinkedQuestionsSummary([
    ...granulars.map((g) => g._id),
    id,
  ]);
};

/**
 * Delete a learning objective and its granular objectives.
 * @param {string|ObjectId} objectiveId - The learning objective ID
 * @param {'keep'|'delete'} questionAction - What to do with linked questions:
 *   'keep' (default) orphans them and moves them to Draft; 'delete' removes them
 *   permanently along with their quiz mappings.
 */
const deleteObjective = async (objectiveId, questionAction = 'keep') => {
  try {
    const db = await databaseService.connect();
    const collection = db.collection('grasp_objective');
    const { ObjectId } = require('mongodb');

    // Convert string ID to ObjectId if needed
    const id = ObjectId.isValid(objectiveId) ? new ObjectId(objectiveId) : objectiveId;

    // Capture the granular ids before deleting so the questions generated
    // from them can be handled afterwards.
    const granulars = await collection
      .find({ parent: id }, { projection: { _id: 1 } })
      .toArray();

    // 1. Delete all granular objectives associated with this parent
    await collection.deleteMany({ parent: id });

    // 2. Delete the parent objective
    const result = await collection.deleteOne({ _id: id });

    // 3. Handle questions generated from the deleted objectives per the
    // instructor's explicit choice: either delete them outright or orphan them
    // (kept as Draft) and pull them from every quiz.
    const affectedObjectiveIds = [...granulars.map((g) => g._id), id];
    if (questionAction === 'delete') {
      await questionService.deleteQuestionsByObjectiveIds(affectedObjectiveIds);
    } else {
      await questionService.orphanQuestionsByObjectiveIds(affectedObjectiveIds);
    }
    
    // 4. Remove material associations
    try {
      await objectiveMaterialService.updateObjectiveMaterialRelations(id.toString(), []);
    } catch (err) {
      console.warn("Could not remove material relations during objective deletion:", err);
    }
    
    if (result.deletedCount === 0) {
      throw new Error('Objective not found');
    }
    
    return true;
  } catch (error) {
    console.error('Error deleting objective:', error);
    throw error;
  }
};

const getObjectiveCourseId = async (objectiveId) => {
  try {
    const db = await databaseService.connect();
    const collection = db.collection('grasp_objective');
    
    // Convert objectiveId to ObjectId if it's a string
    const id = ObjectId.isValid(objectiveId) ? new ObjectId(objectiveId) : objectiveId;
    
    const objective = await collection.findOne({ _id: id });
    return objective?.courseId;
  } catch (error) {
    console.error('Error getting objective course ID:', error);
    throw error;
  }
};

module.exports = {
  getParentObjectives,
  getDetailedObjectives,
  getGranularObjectives,
  createObjective,
  getObjectiveById,
  getObjectiveWithMaterials,
  updateObjective,
  getObjectiveDeletionImpact,
  deleteObjective,
  getObjectiveCourseId,
};
