// How a material remembers the LMS file it was imported from
// (src/services/material.js), which is what stops a second copy.
jest.mock('../../src/services/database', () => ({ connect: jest.fn() }));

const { ObjectId } = require('mongodb');
const databaseService = require('../../src/services/database');
const { saveMaterial, findLmsImportedMaterials } = require('../../src/services/material');

const COURSE_ID = '507f1f77bcf86cd799439011';

describe('LMS provenance on materials', () => {
  let collection;
  let cursor;

  beforeEach(() => {
    cursor = { toArray: jest.fn().mockResolvedValue([]) };
    collection = {
      insertOne: jest.fn().mockResolvedValue({ acknowledged: true }),
      find: jest.fn(() => cursor),
    };
    databaseService.connect.mockResolvedValue({
      collection: jest.fn((name) => {
        if (name === 'grasp_material') return collection;
        throw new Error(`Unexpected collection: ${name}`);
      }),
    });
  });

  const fields = { fileType: 'application/pdf', fileSize: 10, fileContent: 'text', documentTitle: 'Lecture 1.pdf' };

  it('stores the LMS source of an imported material', async () => {
    const lms = { provider: 'canvas', instance: 'https://canvas.example.test', externalCourseId: '42', externalFileId: '7001' };

    await saveMaterial('source-1', COURSE_ID, { ...fields, lms });

    expect(collection.insertOne).toHaveBeenCalledWith(expect.objectContaining({ sourceId: 'source-1', lms }));
  });

  it('stores no lms field for an upload or pasted text', async () => {
    await saveMaterial('source-1', COURSE_ID, fields);

    expect(collection.insertOne.mock.calls[0][0]).not.toHaveProperty('lms');
  });

  it('finds the materials imported from one Canvas course, without their text', async () => {
    const found = [{ sourceId: 'source-1', documentTitle: 'Lecture 1.pdf', lms: { externalFileId: '7001' } }];
    cursor.toArray.mockResolvedValue(found);

    const result = await findLmsImportedMaterials(COURSE_ID, {
      provider: 'canvas',
      instance: 'https://canvas.example.test',
      externalCourseId: 42,
    });

    expect(result).toBe(found);
    expect(collection.find).toHaveBeenCalledWith(
      {
        courseId: new ObjectId(COURSE_ID),
        'lms.provider': 'canvas',
        'lms.instance': 'https://canvas.example.test',
        'lms.externalCourseId': '42',
      },
      { projection: { sourceId: 1, documentTitle: 1, lms: 1 } }
    );
  });

  it('narrows the lookup to one Canvas file when asked', async () => {
    await findLmsImportedMaterials(COURSE_ID, {
      provider: 'canvas',
      instance: 'https://canvas.example.test',
      externalCourseId: '42',
      externalFileId: 7001,
    });

    expect(collection.find.mock.calls[0][0]).toEqual(expect.objectContaining({
      'lms.externalFileId': '7001',
    }));
  });
});
