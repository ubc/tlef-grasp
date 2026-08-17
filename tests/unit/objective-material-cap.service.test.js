const { ObjectId } = require('mongodb');

jest.mock('../../src/services/database', () => ({
  connect: jest.fn(),
}));

const databaseService = require('../../src/services/database');
const {
  createObjectiveMaterialRelations,
  updateObjectiveMaterialRelations,
  getMaterialsForObjective,
  MaterialCapExceededError,
} = require('../../src/services/objective-material');
const { MAX_MATERIALS_PER_OBJECTIVE } = require('../../src/constants/app-constants');

const makeMaterial = (sourceId) => ({ _id: new ObjectId(), sourceId });

describe('material cap per learning objective', () => {
  let relationshipCollection;
  let materialCollection;

  const stubMaterialLookup = (materials) => {
    materialCollection.find.mockReturnValue({
      toArray: jest.fn().mockResolvedValue(materials),
    });
  };

  beforeEach(() => {
    relationshipCollection = {
      insertMany: jest.fn().mockResolvedValue({ insertedCount: 0 }),
      deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }),
      find: jest.fn(() => ({ toArray: jest.fn().mockResolvedValue([]) })),
    };
    materialCollection = {
      find: jest.fn(() => ({ toArray: jest.fn().mockResolvedValue([]) })),
      findOne: jest.fn(),
    };
    databaseService.connect.mockResolvedValue({
      collection: jest.fn((name) => {
        if (name === 'grasp_objective_material') return relationshipCollection;
        if (name === 'grasp_material') return materialCollection;
        throw new Error(`Unexpected collection: ${name}`);
      }),
    });
  });

  it('exposes the cap as a shared constant', () => {
    expect(MAX_MATERIALS_PER_OBJECTIVE).toBe(3);
  });

  it('accepts exactly the maximum number of materials', async () => {
    const sourceIds = ['m1', 'm2', 'm3'];
    stubMaterialLookup(sourceIds.map(makeMaterial));

    await createObjectiveMaterialRelations(new ObjectId().toString(), sourceIds);

    expect(relationshipCollection.insertMany).toHaveBeenCalledTimes(1);
    expect(relationshipCollection.insertMany.mock.calls[0][0]).toHaveLength(3);
  });

  it('rejects more than the maximum without writing anything', async () => {
    const attempt = createObjectiveMaterialRelations(new ObjectId().toString(), [
      'm1',
      'm2',
      'm3',
      'm4',
    ]);

    await expect(attempt).rejects.toThrow(MaterialCapExceededError);
    await expect(attempt).rejects.toMatchObject({
      code: 'MATERIAL_CAP_EXCEEDED',
      attempted: 4,
      max: 3,
    });
    expect(relationshipCollection.insertMany).not.toHaveBeenCalled();
  });

  // updateObjectiveMaterialRelations deletes before it creates. Guarding only
  // the create would wipe the instructor's existing materials and then fail.
  it('rejects an over-cap update before deleting existing links', async () => {
    await expect(
      updateObjectiveMaterialRelations(new ObjectId().toString(), ['m1', 'm2', 'm3', 'm4'])
    ).rejects.toThrow(MaterialCapExceededError);

    expect(relationshipCollection.deleteMany).not.toHaveBeenCalled();
    expect(relationshipCollection.insertMany).not.toHaveBeenCalled();
  });

  it('still reads back every material on a legacy over-cap objective', async () => {
    const objectiveId = new ObjectId();
    const legacy = ['m1', 'm2', 'm3', 'm4', 'm5'].map(makeMaterial);
    relationshipCollection.find.mockReturnValue({
      toArray: jest
        .fn()
        .mockResolvedValue(legacy.map((m) => ({ objectiveId, materialId: m._id }))),
    });
    stubMaterialLookup(legacy);

    await expect(getMaterialsForObjective(objectiveId.toString())).resolves.toHaveLength(5);
  });
});
