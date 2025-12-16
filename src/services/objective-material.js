const databaseService = require('./database');

/**
 * Create a relationship between a learning objective and materials
 * @param {string|ObjectId} objectiveId - The learning objective ID (can be ObjectId or string)
 * @param {Array<string>} materialIds - Array of material sourceIds
 */
const createObjectiveMaterialRelations = async (objectiveId, materialIds) => {
  try {
    const db = await databaseService.connect();
    const collection = db.collection('grasp_objective_material');
    
    if (!materialIds || materialIds.length === 0) {
      return { insertedCount: 0 };
    }
    
    // Convert objectiveId to string for consistent storage
    const objectiveIdStr = objectiveId.toString();
    
    // Create relationship documents
    const relationships = materialIds.map(materialId => ({
      objectiveId: objectiveIdStr,
      materialId: materialId,
      createdAt: new Date(),
    }));
    
    const result = await collection.insertMany(relationships);
    return result;
  } catch (error) {
    console.error('Error creating objective-material relationships:', error);
    throw error;
  }
};

/**
 * Get all materials for a learning objective
 * @param {string} objectiveId - The learning objective ID (can be ObjectId or string)
 */
const getMaterialsForObjective = async (objectiveId) => {

  try {
    const db = await databaseService.connect();
    const relationshipCollection = db.collection('grasp_objective_material');
    const materialCollection = db.collection('grasp_material');
    
    // Convert objectiveId to string for consistent lookup
    const objectiveIdStr = objectiveId.toString();
    
    // Find all relationships for this objective
    const relationships = await relationshipCollection.find({ objectiveId: objectiveIdStr }).toArray();
    
    if (relationships.length === 0) {
      return [];
    }
    
    // Get material IDs (sourceIds)
    const materialIds = relationships.map(rel => rel.materialId);
    
    // Fetch materials by sourceId
    const materials = await materialCollection.find({ sourceId: { $in: materialIds } }).toArray();
    
    return materials;
  } catch (error) {
    console.error('Error getting materials for objective:', error);
    throw error;
  }
};

/**
 * Get all learning objectives for a material
 * @param {string} materialId - The material sourceId
 */
const getObjectivesForMaterial = async (materialId) => {
  try {
    const db = await databaseService.connect();
    const relationshipCollection = db.collection('grasp_objective_material');
    const objectiveCollection = db.collection('grasp_objective');
    
    // Find all relationships for this material
    const relationships = await relationshipCollection.find({ materialId: materialId }).toArray();
    
    if (relationships.length === 0) {
      return [];
    }
    
    // Get objective IDs
    const objectiveIds = relationships.map(rel => rel.objectiveId);
    
    // Convert string IDs to ObjectId if needed
    const { ObjectId } = require('mongodb');
    const objectIds = objectiveIds.map(id => ObjectId.isValid(id) ? new ObjectId(id) : id);
    
    // Fetch objectives
    const objectives = await objectiveCollection.find({ _id: { $in: objectIds } }).toArray();
    
    return objectives;
  } catch (error) {
    console.error('Error getting objectives for material:', error);
    throw error;
  }
};

/**
 * Remove a relationship between a learning objective and a material
 * @param {string} objectiveId - The learning objective ID
 * @param {string} materialId - The material sourceId
 */
const removeObjectiveMaterialRelation = async (objectiveId, materialId) => {
  try {
    const db = await databaseService.connect();
    const collection = db.collection('grasp_objective_material');
    
    const result = await collection.deleteOne({
      objectiveId: objectiveId,
      materialId: materialId,
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
    
    // Convert objectiveId to string for consistent lookup
    const objectiveIdStr = objectiveId.toString();
    
    const result = await collection.deleteMany({ objectiveId: objectiveIdStr });
    return result;
  } catch (error) {
    console.error('Error removing all relationships for objective:', error);
    throw error;
  }
};

/**
 * Update relationships for a learning objective (replace existing with new ones)
 * @param {string|ObjectId} objectiveId - The learning objective ID (can be ObjectId or string)
 * @param {Array<string>} materialIds - Array of material sourceIds
 */
const updateObjectiveMaterialRelations = async (objectiveId, materialIds) => {
  try {
    // Remove existing relationships
    await removeAllRelationsForObjective(objectiveId);
    
    // Create new relationships
    if (materialIds && materialIds.length > 0) {
      await createObjectiveMaterialRelations(objectiveId, materialIds);
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
