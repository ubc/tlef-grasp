const { ObjectId } = require('mongodb');

jest.mock('../../src/services/objective', () => ({
  getParentObjectives: jest.fn(),
  getDetailedObjectives: jest.fn(),
  getGranularObjectives: jest.fn(),
  createObjective: jest.fn(),
  updateObjective: jest.fn(),
  getObjectiveDeletionImpact: jest.fn(),
  deleteObjective: jest.fn(),
  getObjectiveCourseId: jest.fn(),
}));
// updateObjectiveMaterialRelations/getMaterialsForObjective are mocked as in
// the sibling route test, but assertWithinMaterialCap is the REAL
// implementation: this test exists to prove the cap is enforced before
// createObjective ever runs, so the guard itself must be genuine.
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
  assertCoInstructorPermission: jest.fn().mockResolvedValue(true),
  PERMISSION_KEYS: { QUESTION_GENERATION: 'questionGeneration' },
}));
jest.mock('../../src/utils/ta-permissions', () => ({
  assertTaPermission: jest.fn().mockResolvedValue(true),
  TA_PERMISSION_KEYS: { QUESTION_GENERATION: 'questionGeneration' },
}));

const objectiveService = require('../../src/services/objective');
const objectiveMaterialService = require('../../src/services/objective-material');
const { createObjectiveHandler } = require('../../src/controllers/objective');
const { MAX_MATERIALS_PER_OBJECTIVE } = require('../../src/constants/app-constants');

const makeRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

describe('POST /api/objective and the material cap', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Regression: previously createObjective (and its granular children) was
  // written first, and only the follow-up updateObjectiveMaterialRelations
  // call enforced the cap — leaving an orphan objective with no materials
  // behind a 400 that the instructor could not fix by retrying.
  it('rejects an over-cap request without creating the objective', async () => {
    const courseId = new ObjectId().toString();
    const overCapMaterialIds = Array.from(
      { length: MAX_MATERIALS_PER_OBJECTIVE + 1 },
      (_, i) => `m${i}`
    );

    const req = {
      user: { id: 'u1' },
      body: {
        name: 'A new objective',
        granularObjectives: [],
        materialIds: overCapMaterialIds,
        courseId,
      },
    };
    const res = makeRes();

    await createObjectiveHandler(req, res);

    expect(objectiveService.createObjective).not.toHaveBeenCalled();
    expect(objectiveMaterialService.updateObjectiveMaterialRelations).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, code: 'MATERIAL_CAP_EXCEEDED' })
    );
  });

  it('still creates the objective and links materials within the cap', async () => {
    const courseId = new ObjectId().toString();
    const parentId = new ObjectId();
    objectiveService.createObjective.mockResolvedValue({
      parent: { _id: parentId, name: 'A new objective' },
      granular: [],
    });

    const req = {
      user: { id: 'u1' },
      body: {
        name: 'A new objective',
        granularObjectives: [],
        materialIds: ['m0', 'm1'],
        courseId,
      },
    };
    const res = makeRes();

    await createObjectiveHandler(req, res);

    expect(objectiveService.createObjective).toHaveBeenCalledTimes(1);
    expect(objectiveMaterialService.updateObjectiveMaterialRelations).toHaveBeenCalledWith(
      parentId.toString(),
      ['m0', 'm1']
    );
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});
