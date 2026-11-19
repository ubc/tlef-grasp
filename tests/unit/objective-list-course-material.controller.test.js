/**
 * The question generation page lists only objectives it can generate from:
 * questions must come from the course material, so an objective with none is
 * not offered. GET /api/objective says which ones have any. Deleted materials
 * do not count (getMaterialsForObjective only returns rows that still exist),
 * and neither does the empty "From Canvas" placeholder a Canvas quiz import
 * links its objectives to.
 */

jest.mock('../../src/services/objective', () => ({
  getParentObjectives: jest.fn(),
}));
jest.mock('../../src/services/objective-material', () => ({
  getMaterialsForObjective: jest.fn(),
}));
jest.mock('../../src/utils/course-access', () => ({
  hasStaffAccessInCourse: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../src/utils/co-instructor-permissions', () => ({
  assertCoInstructorPermission: jest.fn(),
  PERMISSION_KEYS: {},
}));
jest.mock('../../src/utils/ta-permissions', () => ({
  assertTaPermission: jest.fn(),
  TA_PERMISSION_KEYS: {},
}));
jest.mock('../../src/utils/auth', () => ({ isFaculty: jest.fn() }));

const { getParentObjectives } = require('../../src/services/objective');
const { getMaterialsForObjective } = require('../../src/services/objective-material');
const { getAllObjectives } = require('../../src/controllers/objective');

const UPLOADED = { _id: 'm1', sourceId: 'source-1', fileType: 'application/pdf' };
const CANVAS_PLACEHOLDER = { _id: 'm2', sourceId: 'course-1-from-canvas', fileType: 'canvas-import' };

const MATERIALS = {
  uploaded: [UPLOADED],
  canvasOnly: [CANVAS_PLACEHOLDER],
  canvasAndUploaded: [CANVAS_PLACEHOLDER, UPLOADED],
  none: [],
};

const listFor = async (...ids) => {
  getParentObjectives.mockResolvedValue(ids.map((id) => ({ _id: id, name: id })));
  getMaterialsForObjective.mockImplementation(async (id) => MATERIALS[id]);
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
  await getAllObjectives({ query: { courseId: 'course-1' }, user: { id: 'u1' } }, res);
  return Object.fromEntries(res.json.mock.calls[0][0].objectives.map((o) => [o._id, o]));
};

describe('GET /api/objective hasCourseMaterial', () => {
  it('is true for an objective with an uploaded material', async () => {
    expect((await listFor('uploaded')).uploaded.hasCourseMaterial).toBe(true);
  });

  it('is false for an objective with no material, or whose materials were all deleted', async () => {
    expect((await listFor('none')).none.hasCourseMaterial).toBe(false);
  });

  it('is false for a Canvas-imported objective linked only to the placeholder', async () => {
    expect((await listFor('canvasOnly')).canvasOnly.hasCourseMaterial).toBe(false);
  });

  it('is true once real material is attached alongside the placeholder', async () => {
    expect((await listFor('canvasAndUploaded')).canvasAndUploaded.hasCourseMaterial).toBe(true);
  });

  it('is false when the materials could not be read', async () => {
    getParentObjectives.mockResolvedValue([{ _id: 'broken', name: 'broken' }]);
    getMaterialsForObjective.mockRejectedValue(new Error('Mongo unavailable'));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };

    await getAllObjectives({ query: { courseId: 'course-1' }, user: { id: 'u1' } }, res);

    expect(res.json.mock.calls[0][0].objectives[0].hasCourseMaterial).toBe(false);
  });
});
