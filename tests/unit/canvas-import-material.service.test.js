// The course's "From Canvas" material (issue #165): the empty placeholder that
// objectives imported from Canvas quizzes link to (src/services/material.js).
jest.mock('../../src/services/database', () => ({ connect: jest.fn() }));

const { ObjectId } = require('mongodb');
const databaseService = require('../../src/services/database');
const { ensureCanvasImportMaterial, isCanvasImportMaterial } = require('../../src/services/material');

const COURSE_ID = '507f1f77bcf86cd799439011';
const SOURCE_ID = `${COURSE_ID}-from-canvas`;

describe('ensureCanvasImportMaterial', () => {
  let collection;
  const stored = { _id: new ObjectId(), sourceId: SOURCE_ID, fileType: 'canvas-import' };

  beforeEach(() => {
    collection = {
      updateOne: jest.fn().mockResolvedValue({ upsertedCount: 1 }),
      findOne: jest.fn().mockResolvedValue(stored),
    };
    databaseService.connect.mockResolvedValue({
      collection: jest.fn((name) => {
        if (name === 'grasp_material') return collection;
        throw new Error(`Unexpected collection: ${name}`);
      }),
    });
  });

  it('creates it once per course under a fixed sourceId and never overwrites it', async () => {
    const material = await ensureCanvasImportMaterial(COURSE_ID);

    expect(material).toBe(stored);
    expect(collection.updateOne).toHaveBeenCalledWith(
      { sourceId: SOURCE_ID },
      {
        $setOnInsert: {
          courseId: new ObjectId(COURSE_ID),
          fileType: 'canvas-import',
          fileSize: 0,
          fileContent: null,
          documentTitle: 'From Canvas',
          createdAt: expect.any(Date),
        },
      },
      { upsert: true },
    );
    expect(collection.findOne).toHaveBeenCalledWith({ sourceId: SOURCE_ID });
  });

  it('returns the one another import created at the same moment', async () => {
    collection.updateOne.mockRejectedValue(Object.assign(new Error('E11000 duplicate key'), { code: 11000 }));

    await expect(ensureCanvasImportMaterial(new ObjectId(COURSE_ID))).resolves.toBe(stored);
  });

  it('passes on any other database error', async () => {
    collection.updateOne.mockRejectedValue(new Error('connection lost'));

    await expect(ensureCanvasImportMaterial(COURSE_ID)).rejects.toThrow('connection lost');
  });
});

describe('isCanvasImportMaterial', () => {
  it('recognises the placeholder by its type', () => {
    expect(isCanvasImportMaterial({ fileType: 'canvas-import' })).toBe(true);
    expect(isCanvasImportMaterial({ fileType: 'application/pdf' })).toBe(false);
    expect(isCanvasImportMaterial(null)).toBe(false);
  });
});
