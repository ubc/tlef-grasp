/**
 * Deleting a material must also remove the objective links that point at it.
 * Left behind, they made the objective look linked while every lookup of its
 * materials came back empty, so questions generated for it had no material.
 */

jest.mock('../../src/services/material', () => ({
  saveMaterial: jest.fn(),
  deleteMaterial: jest.fn(),
  replaceMaterial: jest.fn(),
  getMaterialBySourceId: jest.fn(),
  getMaterialCourseId: jest.fn(),
  getCourseMaterials: jest.fn(),
  clearMaterialOutline: jest.fn(),
}));
jest.mock('../../src/services/objective-material', () => ({
  removeAllRelationsForMaterial: jest.fn(),
}));
jest.mock('../../src/services/rag', () => ({
  addDocumentToRAG: jest.fn(),
  deleteDocumentFromRAG: jest.fn(),
}));
jest.mock('../../src/services/material-outline', () => ({ generateOutline: jest.fn() }));
jest.mock('../../src/utils/safe-fetch-url', () => ({
  fetchReadableText: jest.fn(),
  BlockedUrlError: class BlockedUrlError extends Error {},
}));
jest.mock('../../src/utils/course-access', () => ({
  hasStaffAccessInCourse: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../src/utils/co-instructor-permissions', () => ({
  assertCoInstructorPermission: jest.fn().mockResolvedValue(true),
  PERMISSION_KEYS: { COURSE_MATERIALS: 'courseMaterials' },
}));
jest.mock('../../src/utils/ta-permissions', () => ({
  assertTaPermission: jest.fn().mockResolvedValue(true),
  TA_PERMISSION_KEYS: { COURSE_MATERIALS: 'courseMaterials' },
}));
jest.mock('../../src/services/course', () => ({ getCourseById: jest.fn() }));
jest.mock('../../src/services/database', () => ({ connect: jest.fn() }));
jest.mock('../../src/utils/parse-in-worker', () => ({ parseInWorker: jest.fn() }));

const materialService = require('../../src/services/material');
const objectiveMaterialService = require('../../src/services/objective-material');
const ragService = require('../../src/services/rag');
const courseAccess = require('../../src/utils/course-access');
const { deleteMaterialHandler } = require('../../src/controllers/material');

const STORED = { _id: 'mongo-id-1', sourceId: 'source-1', courseId: 'course-1' };

const makeRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

const deleteRequest = () => ({ params: { sourceId: 'source-1' }, user: { id: 'u1' }, body: {} });

beforeAll(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterAll(() => {
  jest.restoreAllMocks();
});

beforeEach(() => {
  jest.clearAllMocks();
  courseAccess.hasStaffAccessInCourse.mockResolvedValue(true);
  materialService.getMaterialBySourceId.mockResolvedValue({ ...STORED });
  materialService.deleteMaterial.mockResolvedValue(undefined);
  objectiveMaterialService.removeAllRelationsForMaterial.mockResolvedValue(2);
  ragService.deleteDocumentFromRAG.mockResolvedValue(undefined);
});

describe('deleteMaterialHandler', () => {
  it('removes the objective links to the deleted material', async () => {
    const res = makeRes();

    await deleteMaterialHandler(deleteRequest(), res);

    expect(materialService.deleteMaterial).toHaveBeenCalledWith('source-1');
    expect(objectiveMaterialService.removeAllRelationsForMaterial).toHaveBeenCalledWith('mongo-id-1');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  // The row goes first: removing links from a material that then failed to
  // delete would leave it in the course but attached to nothing.
  it('removes the links only after the material itself is gone', async () => {
    const order = [];
    materialService.deleteMaterial.mockImplementation(async () => order.push('material'));
    objectiveMaterialService.removeAllRelationsForMaterial.mockImplementation(async () => order.push('links'));

    await deleteMaterialHandler(deleteRequest(), makeRes());

    expect(order).toEqual(['material', 'links']);
  });

  it('keeps every link when the material could not be deleted', async () => {
    materialService.deleteMaterial.mockRejectedValue(new Error('Mongo unavailable'));
    const res = makeRes();

    await deleteMaterialHandler(deleteRequest(), res);

    expect(objectiveMaterialService.removeAllRelationsForMaterial).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('answers 404 for a material that does not exist', async () => {
    materialService.getMaterialBySourceId.mockResolvedValue(null);
    const res = makeRes();

    await deleteMaterialHandler(deleteRequest(), res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(materialService.deleteMaterial).not.toHaveBeenCalled();
  });

  it('checks course access against the material’s own course', async () => {
    courseAccess.hasStaffAccessInCourse.mockResolvedValue(false);
    const res = makeRes();

    await deleteMaterialHandler(deleteRequest(), res);

    expect(courseAccess.hasStaffAccessInCourse).toHaveBeenCalledWith(expect.anything(), 'course-1');
    expect(res.status).toHaveBeenCalledWith(403);
    expect(materialService.deleteMaterial).not.toHaveBeenCalled();
  });
});
