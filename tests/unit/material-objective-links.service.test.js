/**
 * Learning objectives link to materials by the material's _id
 * (grasp_objective_material.materialId). Editing a material used to delete its
 * row and insert a new one, which gave it a new _id and left every link
 * pointing at a row that no longer existed; deleting one left its links behind.
 * Either way the objective silently lost its material, and questions generated
 * for it afterwards had nothing from the course to draw on.
 */
const { ObjectId } = require('mongodb');

jest.mock('../../src/services/database', () => ({ connect: jest.fn() }));

const databaseService = require('../../src/services/database');
const { replaceMaterial } = require('../../src/services/material');
const { removeAllRelationsForMaterial } = require('../../src/services/objective-material');

const STORED = {
  _id: new ObjectId(),
  sourceId: 'source-1',
  courseId: new ObjectId(),
  fileType: 'text/plain',
  fileSize: 36,
  fileContent: 'The original extracted lecture text.',
  documentTitle: 'Lecture 3',
  createdAt: new Date('2026-01-01'),
  outline: { topics: [{ title: 'T', keyPoints: ['p'] }], notes: '' },
  outlineSource: 'generated',
};

const NEW_FIELDS = {
  fileType: 'text/plain',
  fileSize: 21,
  fileContent: 'Revised lecture text.',
  documentTitle: 'Lecture 3 (revised)',
};

describe('replaceMaterial', () => {
  let collection;

  beforeEach(() => {
    collection = { replaceOne: jest.fn().mockResolvedValue({ matchedCount: 1 }) };
    databaseService.connect.mockResolvedValue({ collection: jest.fn(() => collection) });
  });

  it('rewrites the row in place, keeping the _id objectives link to', async () => {
    await replaceMaterial(STORED, NEW_FIELDS);

    const [filter, document] = collection.replaceOne.mock.calls[0];
    expect(filter).toEqual({ _id: STORED._id });
    expect(document._id).toBe(STORED._id);
    expect(document).toEqual(expect.objectContaining({
      sourceId: 'source-1',
      courseId: STORED.courseId,
      createdAt: STORED.createdAt,
      ...NEW_FIELDS,
    }));
    expect(document.updatedAt).toBeInstanceOf(Date);
  });

  it('drops the outline, which described the old text', async () => {
    await replaceMaterial(STORED, NEW_FIELDS);

    const document = collection.replaceOne.mock.calls[0][1];
    expect(document).not.toHaveProperty('outline');
    expect(document).not.toHaveProperty('outlineSource');
  });

  it('keeps the LMS source of an imported material when the new fields carry it', async () => {
    const lms = { provider: 'canvas', externalCourseId: '42', externalFileId: '7001' };

    await replaceMaterial(STORED, { ...NEW_FIELDS, lms });

    expect(collection.replaceOne.mock.calls[0][1].lms).toEqual(lms);
  });

  it('fails rather than silently doing nothing when the row is gone', async () => {
    collection.replaceOne.mockResolvedValue({ matchedCount: 0 });

    await expect(replaceMaterial(STORED, NEW_FIELDS)).rejects.toThrow(/source-1/);
  });
});

describe('removeAllRelationsForMaterial', () => {
  let collection;

  beforeEach(() => {
    collection = { deleteMany: jest.fn().mockResolvedValue({ deletedCount: 3 }) };
    databaseService.connect.mockResolvedValue({ collection: jest.fn(() => collection) });
  });

  it('removes every objective link to the material', async () => {
    const materialId = new ObjectId();

    const removed = await removeAllRelationsForMaterial(materialId);

    expect(collection.deleteMany).toHaveBeenCalledWith({ materialId });
    expect(removed).toBe(3);
  });

  it('accepts the _id as a string, as it arrives from a request', async () => {
    const materialId = new ObjectId();

    await removeAllRelationsForMaterial(String(materialId));

    expect(collection.deleteMany).toHaveBeenCalledWith({ materialId });
  });
});
