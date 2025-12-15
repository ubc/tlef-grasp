const databaseService = require('./database');
const objectiveMaterialService = require('./objective-material');

/**
 * Get all parent learning objectives (parent = 0)
 */
const getParentObjectives = async () => {
  try {
    const db = await databaseService.connect();
    const collection = db.collection('grasp_objective');
    const objectives = await collection.find({ parent: 0 }).toArray();
    return objectives;
  } catch (error) {
    console.error('Error getting parent objectives:', error);
    throw error;
  }
};

/**
 * Get all granular objectives for a parent objective
 */
const getGranularObjectives = async (parentId) => {
  try {
    const db = await databaseService.connect();
    const collection = db.collection('grasp_objective');
    const objectives = await collection.find({ parent: parentId }).toArray();
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
    
    // Create parent objective (no materialIds stored here)
    const parentObjective = {
      name: objectiveData.name,
      parent: 0,
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
        createdAt: new Date(),
        updatedAt: new Date(),
      }));
      
      if (granularObjectives.length > 0) {
        const result = await collection.insertMany(granularObjectives);
        // Get the created granular objectives
        const { ObjectId } = require('mongodb');
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
 */
const getObjectiveById = async (objectiveId) => {
  try {
    const db = await databaseService.connect();
    const collection = db.collection('grasp_objective');
    const { ObjectId } = require('mongodb');
    
    // Convert string ID to ObjectId if needed
    const id = ObjectId.isValid(objectiveId) ? new ObjectId(objectiveId) : objectiveId;
    const objective = await collection.findOne({ _id: id });
    return objective;
  } catch (error) {
    console.error('Error getting objective by ID:', error);
    throw error;
  }
};

/**
 * Get a learning objective with its associated materials
 */
const getObjectiveWithMaterials = async (objectiveId) => {
  try {
    const objective = await getObjectiveById(objectiveId);
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
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        }
      });
      
      // Update existing granular objectives
      const updatePromises = granularToUpdate.map(granular => 
        collection.updateOne(
          { _id: granular.id, parent: id },
          { 
            $set: { 
              name: granular.name,
              updatedAt: new Date()
            }
          }
        )
      );
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

module.exports = {
  getParentObjectives,
  getGranularObjectives,
  createObjective,
  getObjectiveById,
  getObjectiveWithMaterials,
  updateObjective,
};
