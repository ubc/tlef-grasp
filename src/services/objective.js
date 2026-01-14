const databaseService = require('./database');
const objectiveMaterialService = require('./objective-material');
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
    
    // Create relationships with materials if provided
    if (objectiveData.materialIds && objectiveData.materialIds.length > 0) {
      await objectiveMaterialService.createObjectiveMaterialRelations(
        parentId.toString(),
        objectiveData.materialIds
      );
    }
    
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
    
    // Pass the objective's _id (which is an ObjectId) to get materials
    const materials = await objectiveMaterialService.getMaterialsForObjective(objective._id);
    
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
        if (granular.id && ObjectId.isValid(granular.id)) {
          // Existing granular objective - update it
          const granularId = new ObjectId(granular.id);
          granularToKeep.push(granularId.toString());
          granularToUpdate.push({
            id: granularId,
            name: granular.text || granular.name,
          });
        } else {
          // New granular objective - create it
          granularToCreate.push({
            name: granular.text || granular.name,
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
      }
    }
    
    // Handle materials update if provided
    if (updateData.materialIds !== undefined) {
      await objectiveMaterialService.updateObjectiveMaterialRelations(
        id.toString(),
        updateData.materialIds || []
      );
    }
    
    // Return the updated objective with its granular objectives
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
  getGranularObjectives,
  createObjective,
  getObjectiveById,
  getObjectiveWithMaterials,
  updateObjective,
  getObjectiveCourseId,
};
