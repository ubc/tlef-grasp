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
jest.mock('../../src/services/objective-material', () => ({
  updateObjectiveMaterialRelations: jest.fn(),
  getMaterialsForObjective: jest.fn(),
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
const { updateObjectiveHandler } = require('../../src/controllers/objective');

const makeRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

describe('PUT /api/objective/:id and material relations', () => {
  // Materials belong to PUT /:id/materials. If this endpoint ever starts
  // honouring materialIds, wizard autosaves would silently rewrite material
  // links whenever an instructor edits a granular objective's text.
  it('never touches material relations, even when sent materialIds', async () => {
    const objectiveId = new ObjectId().toString();
    const courseId = new ObjectId().toString();
    objectiveService.updateObjective.mockResolvedValue({
      _id: objectiveId,
      name: 'Renamed',
      granularObjectives: [],
    });

    const req = {
      params: { id: objectiveId },
      user: { id: 'u1' },
      body: {
        name: 'Renamed',
        courseId,
        materialIds: ['m1', 'm2', 'm3', 'm4', 'm5'],
        granularObjectives: [],
      },
    };
    const res = makeRes();

    await updateObjectiveHandler(req, res);

    expect(objectiveMaterialService.updateObjectiveMaterialRelations).not.toHaveBeenCalled();
    expect(objectiveService.updateObjective).toHaveBeenCalledWith(
      objectiveId,
      expect.not.objectContaining({ materialIds: expect.anything() })
    );
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});
