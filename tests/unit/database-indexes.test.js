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
  const runInitializeCollections = async () => {
    const collections = new Map();
    const collectionFor = (name) => {
      if (!collections.has(name)) {
        collections.set(name, {
          createIndex: jest.fn().mockResolvedValue(undefined),
          dropIndex: jest.fn().mockResolvedValue(undefined),
          updateMany: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
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
    return collectionFor;
  };

  it('makes courseCode unique across live courses only', async () => {
    const collectionFor = await runInitializeCollections();

    const courseIndexCalls = collectionFor('grasp_course').createIndex.mock.calls;
    const courseCodeCall = courseIndexCalls.find(
      ([keys]) => keys && keys.courseCode === 1
    );

    expect(courseCodeCall).toBeDefined();
    const [, options] = courseCodeCall;
    expect(options.unique).toBe(true);
    // Plain equality on an explicit `archived: false`. Neither `$ne: true` nor
    // `$exists: false` is expressible here — see the grammar test below — so
    // live courses carry the field explicitly and the backfill below fills it
    // in for shells created before that was true.
    expect(options.partialFilterExpression).toEqual({ archived: false });
  });

  it('backfills archived:false before building the courseCode index', async () => {
    const collectionFor = await runInitializeCollections();
    const course = collectionFor('grasp_course');

    // The partial filter only covers documents that carry `archived: false`.
    // Legacy shells predate the field, so without this backfill they drop out
    // of the index and their course codes stop being reserved at all.
    expect(course.updateMany).toHaveBeenCalledWith(
      { archived: { $exists: false } },
      { $set: { archived: false } }
    );
    expect(course.updateMany.mock.invocationCallOrder[0])
      .toBeLessThan(course.createIndex.mock.invocationCallOrder[0]);
  });

  // The suite above mocks createIndex, so MongoDB never parses these specs and
  // an unsupported operator sails through as a green test right up until it
  // throws CannotCreateIndex at boot. partialFilterExpression accepts only a
  // restricted grammar: equality, $exists:true, $type, $gt/$gte/$lt/$lte,
  // $and/$or/$in. Everything else -- $ne and $exists:false included, both of
  // which desugar to $not -- is rejected.
  it('uses only operators MongoDB permits in a partial filter', async () => {
    const collectionFor = await runInitializeCollections();
    const ALLOWED = new Set([
      '$exists', '$type', '$eq', '$gt', '$gte', '$lt', '$lte', '$and', '$or', '$in',
    ]);

    const walk = (node, path) => {
      if (Array.isArray(node)) return node.forEach((n) => walk(n, path));
      if (!node || typeof node !== 'object') return;
      for (const [key, value] of Object.entries(node)) {
        if (key.startsWith('$')) {
          expect(`${path}.${key}`).toBe(
            ALLOWED.has(key) ? `${path}.${key}` : `${path}: <unsupported operator ${key}>`
          );
          // $exists is only legal in its positive form.
          if (key === '$exists') expect(`${path}.$exists=${value}`).toBe(`${path}.$exists=true`);
        }
        walk(value, `${path}.${key}`);
      }
    };

    const specs = [];
    for (const name of ['grasp_course', 'grasp_question', 'grasp_user', 'grasp_user_course']) {
      for (const [, options] of collectionFor(name).createIndex.mock.calls) {
        if (options?.partialFilterExpression) specs.push([name, options.partialFilterExpression]);
      }
    }

    expect(specs.length).toBeGreaterThan(0);
    specs.forEach(([name, pfe]) => walk(pfe, name));
  });
});
