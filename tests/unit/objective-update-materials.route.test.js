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
const courseAccess = require('../../src/utils/course-access');
const { updateObjectiveHandler } = require('../../src/controllers/objective');

const makeRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

describe('PUT /api/objective/:id and material relations', () => {
  beforeEach(() => {
    courseAccess.hasStaffAccessInCourse.mockResolvedValue(true);
  });

  // Materials belong to PUT /:id/materials. If this endpoint ever starts
  // honouring materialIds, wizard autosaves would silently rewrite material
  // links whenever an instructor edits a granular objective's text.
  it('never touches material relations, even when sent materialIds', async () => {
    const objectiveId = new ObjectId().toString();
    const courseId = new ObjectId().toString();
    objectiveService.getObjectiveCourseId.mockResolvedValue(courseId);
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

  // H5 regression: authorisation used to be checked against req.body.courseId
  // while the write targeted the objective by _id alone, so a caller with access
  // to course A could pass an objective id from course B and rewrite it. The
  // course must come from the objective, never the body.
  it('authorises against the objective\u2019s own course, ignoring the body courseId', async () => {
    const objectiveId = new ObjectId().toString();
    const realCourseId = new ObjectId().toString();
    const attackerCourseId = new ObjectId().toString();
    objectiveService.getObjectiveCourseId.mockResolvedValue(realCourseId);
    courseAccess.hasStaffAccessInCourse.mockResolvedValue(false);

    const res = makeRes();
    await updateObjectiveHandler(
      {
        params: { id: objectiveId },
        user: { id: 'u1' },
        body: { name: 'Hijacked', courseId: attackerCourseId },
      },
      res
    );

    expect(courseAccess.hasStaffAccessInCourse).toHaveBeenCalledWith(
      { id: 'u1' },
      realCourseId
    );
    expect(res.status).toHaveBeenCalledWith(403);
    expect(objectiveService.updateObjective).not.toHaveBeenCalled();
  });

  // courseId was writable, so the same request could also move another course's
  // objective into the caller's own course.
  it('never writes courseId, even when the body supplies one', async () => {
    const objectiveId = new ObjectId().toString();
    const realCourseId = new ObjectId().toString();
    objectiveService.getObjectiveCourseId.mockResolvedValue(realCourseId);
    objectiveService.updateObjective.mockResolvedValue({ _id: objectiveId, name: 'Renamed' });

    await updateObjectiveHandler(
      {
        params: { id: objectiveId },
        user: { id: 'u1' },
        body: { name: 'Renamed', courseId: new ObjectId().toString() },
      },
      makeRes()
    );

    expect(objectiveService.updateObjective).toHaveBeenCalledWith(
      objectiveId,
      expect.not.objectContaining({ courseId: expect.anything() })
    );
  });

  it('404s for an objective that does not exist, before any permission check', async () => {
    objectiveService.getObjectiveCourseId.mockResolvedValue(undefined);

    const res = makeRes();
    await updateObjectiveHandler(
      { params: { id: new ObjectId().toString() }, user: { id: 'u1' }, body: { name: 'x' } },
      res
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(courseAccess.hasStaffAccessInCourse).not.toHaveBeenCalled();
    expect(objectiveService.updateObjective).not.toHaveBeenCalled();
  });
});
