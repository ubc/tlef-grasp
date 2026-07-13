const databaseService = require('../../src/services/database');

describe('DatabaseService.createOrReplaceIndex', () => {
  it('replaces a legacy index when MongoDB reports conflicting options', async () => {
    const conflict = Object.assign(new Error('Index already exists with different specs'), {
      code: 86,
      codeName: 'IndexKeySpecsConflict',
    });
    const collection = {
      createIndex: jest.fn()
        .mockRejectedValueOnce(conflict)
        .mockResolvedValueOnce('userId_1_courseId_1_learningObjectiveId_1'),
      dropIndex: jest.fn().mockResolvedValue(undefined),
    };
    const keys = { userId: 1, courseId: 1, learningObjectiveId: 1 };
    const options = {
      name: 'userId_1_courseId_1_learningObjectiveId_1',
      unique: true,
      partialFilterExpression: { learningObjectiveId: { $type: 'objectId' } },
    };

    await databaseService.createOrReplaceIndex(collection, keys, options);

    expect(collection.dropIndex).toHaveBeenCalledWith(options.name);
    expect(collection.createIndex).toHaveBeenNthCalledWith(2, keys, options);
  });

  it('does not drop an index for unrelated database errors', async () => {
    const error = Object.assign(new Error('duplicate data'), { code: 11000 });
    const collection = {
      createIndex: jest.fn().mockRejectedValue(error),
      dropIndex: jest.fn(),
    };

    await expect(databaseService.createOrReplaceIndex(
      collection,
      { userId: 1 },
      { name: 'userId_1', unique: true }
    )).rejects.toBe(error);
    expect(collection.dropIndex).not.toHaveBeenCalled();
  });
});
