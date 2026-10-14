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
jest.mock('../../src/utils/auth', () => ({
  isFaculty: jest.fn(),
}));

const objectiveService = require('../../src/services/objective');
const { isFaculty } = require('../../src/utils/auth');
const {
  deleteObjectiveHandler,
  updateObjectiveHandler,
} = require('../../src/controllers/objective');

const makeRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

// A TA (or staff co-instructor) with Question Generation can delete and edit
// objectives, but deleting the questions attached to them is a Question Bank
// delete, which is faculty-only. The UI hides that option; the API must refuse
// it too, or a direct request deletes every linked question in the course.
describe('questionAction=delete on objective endpoints is faculty-only', () => {
  const objectiveId = new ObjectId().toString();
  const courseId = new ObjectId().toString();

  beforeEach(() => {
    jest.clearAllMocks();
    objectiveService.getObjectiveCourseId.mockResolvedValue(courseId);
    objectiveService.updateObjective.mockResolvedValue({
      _id: objectiveId,
      granularObjectives: [],
    });
  });

  describe('DELETE /api/objective/:id', () => {
    it('refuses a non-faculty request to delete the linked questions', async () => {
      isFaculty.mockResolvedValue(false);
      const res = makeRes();

      await deleteObjectiveHandler(
        { params: { id: objectiveId }, query: { questionAction: 'delete' }, user: { id: 'ta' } },
        res
      );

      expect(res.status).toHaveBeenCalledWith(403);
      expect(objectiveService.deleteObjective).not.toHaveBeenCalled();
    });

    it('still lets a non-faculty user delete the objective and keep its questions', async () => {
      isFaculty.mockResolvedValue(false);
      const res = makeRes();

      await deleteObjectiveHandler(
        { params: { id: objectiveId }, query: { questionAction: 'keep' }, user: { id: 'ta' } },
        res
      );

      expect(objectiveService.deleteObjective).toHaveBeenCalledWith(objectiveId, 'keep');
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('lets faculty delete the linked questions', async () => {
      isFaculty.mockResolvedValue(true);
      const res = makeRes();

      await deleteObjectiveHandler(
        { params: { id: objectiveId }, query: { questionAction: 'delete' }, user: { id: 'prof' } },
        res
      );

      expect(objectiveService.deleteObjective).toHaveBeenCalledWith(objectiveId, 'delete');
    });
  });

  describe('PUT /api/objective/:id', () => {
    it('refuses a non-faculty request to delete questions of removed granulars', async () => {
      isFaculty.mockResolvedValue(false);
      const res = makeRes();

      await updateObjectiveHandler(
        {
          params: { id: objectiveId },
          user: { id: 'ta' },
          body: { granularObjectives: [], questionAction: 'delete' },
        },
        res
      );

      expect(res.status).toHaveBeenCalledWith(403);
      expect(objectiveService.updateObjective).not.toHaveBeenCalled();
    });

    it('still lets a non-faculty user edit granulars and keep their questions', async () => {
      isFaculty.mockResolvedValue(false);
      const res = makeRes();

      await updateObjectiveHandler(
        {
          params: { id: objectiveId },
          user: { id: 'ta' },
          body: { granularObjectives: [], questionAction: 'keep' },
        },
        res
      );

      expect(objectiveService.updateObjective).toHaveBeenCalledWith(
        objectiveId,
        expect.objectContaining({ questionAction: 'keep' })
      );
    });

    it('lets faculty delete questions of removed granulars', async () => {
      isFaculty.mockResolvedValue(true);
      const res = makeRes();

      await updateObjectiveHandler(
        {
          params: { id: objectiveId },
          user: { id: 'prof' },
          body: { granularObjectives: [], questionAction: 'delete' },
        },
        res
      );

      expect(objectiveService.updateObjective).toHaveBeenCalledWith(
        objectiveId,
        expect.objectContaining({ questionAction: 'delete' })
      );
    });
  });
});
