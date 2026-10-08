// createObjective and Canvas import provenance (#140). A Canvas group becomes
// one parent objective carrying `source` ({ kind, quizIdent, slotIdent }) so
// re-import finds it; its granular children carry none. Objectives created any
// other way keep their exact shape, and POST /api/objective takes no source
// from a client.

jest.mock('../../src/services/database', () => ({ connect: jest.fn() }));
// Material links are their own collection and suite; the cap check stays real.
jest.mock('../../src/services/objective-material', () => ({
  updateObjectiveMaterialRelations: jest.fn(),
  getMaterialsForObjective: jest.fn(),
  assertWithinMaterialCap: jest.requireActual('../../src/services/objective-material')
    .assertWithinMaterialCap,
}));
jest.mock('../../src/utils/course-access', () => ({
  hasStaffAccessInCourse: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../src/utils/co-instructor-permissions', () => ({
  ...jest.requireActual('../../src/utils/co-instructor-permissions'),
  assertCoInstructorPermission: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../src/utils/ta-permissions', () => ({
  ...jest.requireActual('../../src/utils/ta-permissions'),
  assertTaPermission: jest.fn().mockResolvedValue(true),
}));

const { ObjectId } = require('mongodb');
const databaseService = require('../../src/services/database');
const { createObjective } = require('../../src/services/objective');
const { createObjectiveHandler } = require('../../src/controllers/objective');

const COURSE_ID = new ObjectId();
const SOURCE = {
  kind: 'canvas-classic',
  quizIdent: 'g0quiz0000000000000000000000000a1',
  slotIdent: 'g0slot0000000000000000000000000c3',
};
const SLOT_NAME = 'Thermochemistry quiz – Q01';

// Every field a parent objective had before #140, in insertion order.
const LEGACY_PARENT_KEYS = ['name', 'parent', 'courseId', 'createdAt', 'updatedAt'];

function mockDb() {
  const parentId = new ObjectId();
  const granularId = new ObjectId();
  const collection = {
    insertOne: jest.fn().mockResolvedValue({ insertedId: parentId }),
    insertMany: jest.fn().mockResolvedValue({ insertedIds: { 0: granularId } }),
    find: jest.fn(() => ({
      toArray: jest.fn().mockResolvedValue([{ _id: granularId, name: SLOT_NAME, parent: parentId }]),
    })),
    findOne: jest.fn().mockResolvedValue({ _id: parentId, name: SLOT_NAME, parent: 0 }),
  };
  databaseService.connect.mockResolvedValue({ collection: jest.fn(() => collection) });
  return collection;
}

describe('createObjective import provenance', () => {
  it('stores the source on the parent and not on its granular child', async () => {
    const collection = mockDb();

    await createObjective({
      name: SLOT_NAME,
      granularObjectives: [{ text: SLOT_NAME }],
      courseId: COURSE_ID.toString(),
      source: SOURCE,
    });

    const parent = collection.insertOne.mock.calls[0][0];
    expect(parent.source).toEqual(SOURCE);
    expect(Object.keys(parent)).toEqual([...LEGACY_PARENT_KEYS, 'source']);

    const [granular] = collection.insertMany.mock.calls[0][0];
    expect(granular.name).toBe(SLOT_NAME);
    expect(granular).not.toHaveProperty('source');
  });

  it('keeps only kind, quizIdent and slotIdent, each capped at 200 characters', async () => {
    const collection = mockDb();

    await createObjective({
      name: SLOT_NAME,
      granularObjectives: [],
      courseId: COURSE_ID.toString(),
      source: { ...SOURCE, slotIdent: 's'.repeat(260), itemIdent: 'g0item', extra: { a: 1 } },
    });

    expect(collection.insertOne.mock.calls[0][0].source).toEqual({ ...SOURCE, slotIdent: 's'.repeat(200) });
  });

  it('writes no source for an objective created without one', async () => {
    const collection = mockDb();

    await createObjective({
      name: 'Explain enthalpy',
      granularObjectives: [{ text: 'Define enthalpy' }],
      courseId: COURSE_ID.toString(),
    });

    expect(Object.keys(collection.insertOne.mock.calls[0][0])).toEqual(LEGACY_PARENT_KEYS);
  });

  it.each([
    ['a string', 'canvas-classic'],
    ['an array', [SOURCE]],
    ['an object without slotIdent', { kind: 'canvas-classic', quizIdent: 'g0quiz' }],
    ['an object with a numeric slotIdent', { ...SOURCE, slotIdent: 3 }],
  ])('writes no source when it is %s', async (_label, source) => {
    const collection = mockDb();

    await createObjective({ name: SLOT_NAME, granularObjectives: [], courseId: COURSE_ID.toString(), source });

    expect(Object.keys(collection.insertOne.mock.calls[0][0])).toEqual(LEGACY_PARENT_KEYS);
  });
});

describe('POST /api/objective ignores client-sent provenance', () => {
  it('creates the parent without the source from the request body', async () => {
    const collection = mockDb();
    const res = { status: jest.fn(), json: jest.fn() };
    res.status.mockReturnValue(res);

    await createObjectiveHandler(
      {
        user: { _id: new ObjectId().toString() },
        body: {
          name: SLOT_NAME,
          granularObjectives: [{ text: SLOT_NAME }],
          courseId: COURSE_ID.toString(),
          source: SOURCE,
        },
      },
      res
    );

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0]).toMatchObject({ success: true });
    expect(Object.keys(collection.insertOne.mock.calls[0][0])).toEqual(LEGACY_PARENT_KEYS);
  });
});
