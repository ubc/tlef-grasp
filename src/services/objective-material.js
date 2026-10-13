const databaseService = require('./database');
const { ObjectId } = require('mongodb');
const { MAX_MATERIALS_PER_OBJECTIVE } = require('../constants/app-constants');

/**
 * Thrown when a write would attach more than MAX_MATERIALS_PER_OBJECTIVE
 * materials to one objective. Carries a `code` so controllers can map it to a
 * 400 without string-matching the message.
 */
class MaterialCapExceededError extends Error {
  constructor(attempted) {
    super(
      `Cannot attach ${attempted} materials to a learning objective; the maximum is ${MAX_MATERIALS_PER_OBJECTIVE}.`
    );
    this.name = 'MaterialCapExceededError';
    this.code = 'MATERIAL_CAP_EXCEEDED';
    this.attempted = attempted;
    this.max = MAX_MATERIALS_PER_OBJECTIVE;
  }
}

/** Throws if the requested material list exceeds the cap. */
const assertWithinMaterialCap = (materialSourceIds) => {
  if (materialSourceIds && materialSourceIds.length > MAX_MATERIALS_PER_OBJECTIVE) {
    throw new MaterialCapExceededError(materialSourceIds.length);
  }
};

/**
 * Create a relationship between a learning objective and materials
 * @param {string|ObjectId} objectiveId - The learning objective ID (can be ObjectId or string)
 * @param {Array<string>} materialSourceIds - Array of material sourceIds (will be converted to material _id)
 */
const createObjectiveMaterialRelations = async (objectiveId, materialSourceIds) => {
  assertWithinMaterialCap(materialSourceIds);
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
 * Link a learning objective to one material (by its _id) unless it already is.
 * Safe to repeat: the (objectiveId, materialId) pair is unique.
 * @param {string|ObjectId} objectiveId
 * @param {ObjectId} materialId - The material's _id
 */
const linkObjectiveToMaterial = async (objectiveId, materialId) => {
  const db = await databaseService.connect();
  const objectiveIdObj = ObjectId.isValid(objectiveId) ? new ObjectId(objectiveId) : objectiveId;
  try {
    await db.collection('grasp_objective_material').updateOne(
      { objectiveId: objectiveIdObj, materialId },
      { $setOnInsert: { createdAt: new Date() } },
      { upsert: true }
    );
  } catch (error) {
    // The same link written at the same moment by someone else.
    if (error?.code !== 11000) throw error;
  }
};

/**
 * Which of these objectives have at least one material. Deleting a material
 * leaves its link rows behind, so only links to materials that still exist
 * count, as on the objective cards.
 * @param {Array<ObjectId>} objectiveIds
 * @returns {Promise<Set<string>>} The ids (as strings) of those with a material
 */
const objectivesWithMaterials = async (objectiveIds) => {
  if (!objectiveIds || objectiveIds.length === 0) return new Set();
  const db = await databaseService.connect();
  const links = await db.collection('grasp_objective_material')
    .find({ objectiveId: { $in: objectiveIds } }, { projection: { objectiveId: 1, materialId: 1 } })
    .toArray();
  if (links.length === 0) return new Set();
  const materials = await db.collection('grasp_material')
    .find({ _id: { $in: links.map((link) => link.materialId) } }, { projection: { _id: 1 } })
    .toArray();
  const existing = new Set(materials.map((material) => String(material._id)));
  return new Set(
    links
      .filter((link) => existing.has(String(link.materialId)))
      .map((link) => String(link.objectiveId))
  );
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
    console.log(`[getMaterialsForObjective] Fetching for objectiveId: ${objectiveId} (as ObjId: ${objectiveIdObj})`);
    
    // Find all relationships for this objective
    const relationships = await relationshipCollection.find({ objectiveId: objectiveIdObj }).toArray();
    console.log(`[getMaterialsForObjective] Found ${relationships.length} relationships`);
    
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
  // Checked before the removal below: this function deletes existing links
  // before creating the new ones, so a late failure would lose data.
  assertWithinMaterialCap(materialSourceIds);
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
  linkObjectiveToMaterial,
  objectivesWithMaterials,
  getMaterialsForObjective,
  getObjectivesForMaterial,
  removeObjectiveMaterialRelation,
  removeAllRelationsForObjective,
  updateObjectiveMaterialRelations,
  assertWithinMaterialCap,
  MaterialCapExceededError,
};
