const { ObjectId } = require('mongodb');

jest.mock('../../src/services/objective', () => ({
  getParentObjectives: jest.fn(),
  getDetailedObjectives: jest.fn(),
  getGranularObjectives: jest.fn(),
  createObjective: jest.fn(),
  updateObjective: jest.fn(),
  appendGranularObjectives: jest.fn(),
  getObjectiveDeletionImpact: jest.fn(),
  deleteObjective: jest.fn(),
  getObjectiveCourseId: jest.fn(),
}));
jest.mock('../../src/services/objective-material', () => ({
  updateObjectiveMaterialRelations: jest.fn(),
  getMaterialsForObjective: jest.fn(),
  assertWithinMaterialCap: jest.fn(),
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
const courseAccess = require('../../src/utils/course-access');
const { appendGranularObjectivesHandler } = require('../../src/controllers/objective');

const makeRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

describe('POST /api/objective/:id/granular', () => {
  const objectiveId = new ObjectId().toString();
  const courseId = new ObjectId().toString();
  const entropy = { granularObjectives: [{ text: 'Entropy' }] };

  const makeReq = (body) => ({ params: { id: objectiveId }, user: { id: 'u1' }, body });

  beforeEach(() => {
    jest.clearAllMocks();
    courseAccess.hasStaffAccessInCourse.mockResolvedValue(true);
    objectiveService.getObjectiveCourseId.mockResolvedValue(courseId);
    objectiveService.appendGranularObjectives.mockResolvedValue({
      parent: { _id: objectiveId },
      granular: [{ _id: 'g1', name: 'Entropy' }],
      added: [{ _id: 'g1', name: 'Entropy' }],
    });
  });

  // Same reason PUT /:id stopped reading courseId from the body: authorising
  // against a course the caller names while writing to an objective found by _id
  // lets a user in course A write into course B.
  it("authorises against the objective's own course, not the body", async () => {
    const res = makeRes();
    await appendGranularObjectivesHandler(
      makeReq({ ...entropy, courseId: new ObjectId().toString() }),
      res
    );

    expect(courseAccess.hasStaffAccessInCourse).toHaveBeenCalledWith({ id: 'u1' }, courseId);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, addedCount: 1 })
    );
  });

  it('403s a user outside the course', async () => {
    courseAccess.hasStaffAccessInCourse.mockResolvedValue(false);
    const res = makeRes();
    await appendGranularObjectivesHandler(makeReq(entropy), res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(objectiveService.appendGranularObjectives).not.toHaveBeenCalled();
  });

  it('rejects a request with nothing to append', async () => {
    for (const body of [{}, { granularObjectives: [] }, { granularObjectives: [{ text: ' ' }] }]) {
      const res = makeRes();
      await appendGranularObjectivesHandler(makeReq(body), res);
      expect(res.status).toHaveBeenCalledWith(400);
    }
    expect(objectiveService.appendGranularObjectives).not.toHaveBeenCalled();
  });
});
