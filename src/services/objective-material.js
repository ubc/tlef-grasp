const databaseService = require('./database');
const { ObjectId } = require('mongodb');

/**
 * Create a relationship between a learning objective and materials
 * @param {string|ObjectId} objectiveId - The learning objective ID (can be ObjectId or string)
 * @param {Array<string>} materialSourceIds - Array of material sourceIds (will be converted to material _id)
 */
const createObjectiveMaterialRelations = async (objectiveId, materialSourceIds) => {
  try {
    const db = await databaseService.connect();
    const relationshipCollection = db.collection('grasp_objective_material');
    const materialCollection = db.collection('grasp_material');
    
    if (!materialSourceIds || materialSourceIds.length === 0) {
      return { insertedCount: 0 };
    }
    
    // Convert objectiveId to ObjectId
    const objectiveIdObj = ObjectId.isValid(objectiveId) ? new ObjectId(objectiveId) : objectiveId;
    
    // Look up materials by sourceId to get their actual _id values
    const materials = await materialCollection.find({ 
      sourceId: { $in: materialSourceIds } 
    }).toArray();
    
    if (materials.length === 0) {
      return { insertedCount: 0 };
    }
    
    // Create relationship documents using material _id (ObjectId)
    const relationships = materials.map(material => ({
      objectiveId: objectiveIdObj,
      materialId: material._id,
      createdAt: new Date(),
    }));
    
    const result = await relationshipCollection.insertMany(relationships);
    return result;
  } catch (error) {
    console.error('Error creating objective-material relationships:', error);
    throw error;
  }
};

/**
 * Get all materials for a learning objective
 * @param {string|ObjectId} objectiveId - The learning objective ID (can be ObjectId or string)
 */
const getMaterialsForObjective = async (objectiveId) => {
  try {
    const db = await databaseService.connect();
    const relationshipCollection = db.collection('grasp_objective_material');
    const materialCollection = db.collection('grasp_material');
    
    // Convert objectiveId to ObjectId
    const objectiveIdObj = ObjectId.isValid(objectiveId) ? new ObjectId(objectiveId) : objectiveId;
    
    // Find all relationships for this objective
    const relationships = await relationshipCollection.find({ objectiveId: objectiveIdObj }).toArray();
    
    if (relationships.length === 0) {
      return [];
    }
    
    // Get material IDs (now stored as ObjectIds)
    const materialIds = relationships.map(rel => rel.materialId);
    
    // Fetch materials by _id
    const materials = await materialCollection.find({ _id: { $in: materialIds } }).toArray();
    
    return materials;
  } catch (error) {
    console.error('Error getting materials for objective:', error);
    throw error;
  }
};

/**
 * Get all learning objectives for a material
 * @param {string|ObjectId} materialId - The material _id (ObjectId) or sourceId (string)
 */
const getObjectivesForMaterial = async (materialId) => {
  try {
    const db = await databaseService.connect();
    const relationshipCollection = db.collection('grasp_objective_material');
    const objectiveCollection = db.collection('grasp_objective');
    const materialCollection = db.collection('grasp_material');
    
    // If materialId is a sourceId (string), look up the actual _id
    let materialIdObj;
    if (ObjectId.isValid(materialId)) {
      materialIdObj = new ObjectId(materialId);
    } else {
      // Assume it's a sourceId, look up the material
      const material = await materialCollection.findOne({ sourceId: materialId });
      if (!material) {
        return [];
      }
      materialIdObj = material._id;
    }
    
    // Find all relationships for this material
    const relationships = await relationshipCollection.find({ materialId: materialIdObj }).toArray();
    
    if (relationships.length === 0) {
      return [];
    }
    
    // Get objective IDs (now stored as ObjectIds)
    const objectiveIds = relationships.map(rel => rel.objectiveId);
    
    // Fetch objectives
    const objectives = await objectiveCollection.find({ _id: { $in: objectiveIds } }).toArray();
    
    return objectives;
  } catch (error) {
    console.error('Error getting objectives for material:', error);
    throw error;
  }
};

/**
 * Remove a relationship between a learning objective and a material
 * @param {string|ObjectId} objectiveId - The learning objective ID
 * @param {string|ObjectId} materialId - The material _id (ObjectId) or sourceId (string)
 */
const removeObjectiveMaterialRelation = async (objectiveId, materialId) => {
  try {
    const db = await databaseService.connect();
    const collection = db.collection('grasp_objective_material');
    const materialCollection = db.collection('grasp_material');
    
    // Convert objectiveId to ObjectId
    const objectiveIdObj = ObjectId.isValid(objectiveId) ? new ObjectId(objectiveId) : objectiveId;
    
    // Convert materialId to ObjectId
    let materialIdObj;
    if (ObjectId.isValid(materialId)) {
      materialIdObj = new ObjectId(materialId);
    } else {
      // Assume it's a sourceId, look up the material
      const material = await materialCollection.findOne({ sourceId: materialId });
      if (!material) {
        return { deletedCount: 0 };
      }
      materialIdObj = material._id;
    }
    
    const result = await collection.deleteOne({
      objectiveId: objectiveIdObj,
      materialId: materialIdObj,
    });
    
    return result;
  } catch (error) {
    console.error('Error removing objective-material relationship:', error);
    throw error;
  }
};

/**
 * Remove all relationships for a learning objective
 * @param {string|ObjectId} objectiveId - The learning objective ID (can be ObjectId or string)
 */
const removeAllRelationsForObjective = async (objectiveId) => {
  try {
    const db = await databaseService.connect();
    const collection = db.collection('grasp_objective_material');
    
    // Convert objectiveId to ObjectId
    const objectiveIdObj = ObjectId.isValid(objectiveId) ? new ObjectId(objectiveId) : objectiveId;
    
    const result = await collection.deleteMany({ objectiveId: objectiveIdObj });
    return result;
  } catch (error) {
    console.error('Error removing all relationships for objective:', error);
    throw error;
  }
};

/**
 * Update relationships for a learning objective (replace existing with new ones)
 * @param {string|ObjectId} objectiveId - The learning objective ID (can be ObjectId or string)
 * @param {Array<string>} materialSourceIds - Array of material sourceIds (will be converted to material _id)
 */
const updateObjectiveMaterialRelations = async (objectiveId, materialSourceIds) => {
  try {
    // Remove existing relationships
    await removeAllRelationsForObjective(objectiveId);
    
    // Create new relationships
    if (materialSourceIds && materialSourceIds.length > 0) {
      await createObjectiveMaterialRelations(objectiveId, materialSourceIds);
    }
    
    return { success: true };
  } catch (error) {
    console.error('Error updating objective-material relationships:', error);
    throw error;
  }
};

module.exports = {
  createObjectiveMaterialRelations,
  getMaterialsForObjective,
  getObjectivesForMaterial,
  removeObjectiveMaterialRelation,
  removeAllRelationsForObjective,
  updateObjectiveMaterialRelations,
};
