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

describe('initializeCollections index definitions', () => {
  // Archiving a course is supposed to release its course code for reuse next
  // term. Filtering archived courses out of getCourseByCode is not enough on
  // its own: grasp_course carries a UNIQUE index on courseCode, so the INSERT
  // of the new shell would still fail with a duplicate-key error whatever the
  // application looked up first. The index has to exclude archived courses for
  // the release to be real.
  it('makes courseCode unique across live courses only', async () => {
    const collections = new Map();
    const collectionFor = (name) => {
      if (!collections.has(name)) {
        collections.set(name, {
          createIndex: jest.fn().mockResolvedValue(undefined),
          dropIndex: jest.fn().mockResolvedValue(undefined),
        });
      }
      return collections.get(name);
    };

    const originalDb = databaseService.db;
    databaseService.db = { collection: jest.fn((name) => collectionFor(name)) };

    try {
      await databaseService.initializeCollections();
    } finally {
      databaseService.db = originalDb;
    }

    const courseIndexCalls = collectionFor('grasp_course').createIndex.mock.calls;
    const courseCodeCall = courseIndexCalls.find(
      ([keys]) => keys && keys.courseCode === 1
    );

    expect(courseCodeCall).toBeDefined();
    const [, options] = courseCodeCall;
    expect(options.unique).toBe(true);
    // $exists: false, not `archived: false`: a live course carries no
    // `archived` field at all, and $ne is not permitted in a partial filter.
    expect(options.partialFilterExpression).toEqual({
      archived: { $exists: false },
    });
  });
});
