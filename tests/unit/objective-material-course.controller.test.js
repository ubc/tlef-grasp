// Materials are looked up by sourceId alone, across every course, so a
// staff member of one course could link an objective to another course's
// material, or generate objectives from its content. Each material must now
// belong to the course the objective is in.
const { ObjectId } = require('mongodb');

jest.mock('../../src/services/objective', () => ({
  getObjectiveCourseId: jest.fn(),
  createObjective: jest.fn(),
}));
jest.mock('../../src/services/objective-material', () => ({
  updateObjectiveMaterialRelations: jest.fn(),
  getMaterialsForObjective: jest.fn(),
  assertWithinMaterialCap: jest.fn(),
}));
jest.mock('../../src/services/material', () => ({
  isCanvasImportMaterial: jest.fn(() => false),
  findMaterialsOutsideCourse: jest.fn(),
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
const materialService = require('../../src/services/material');
const { createObjectiveHandler, updateObjectiveMaterials } = require('../../src/controllers/objective');

const COURSE = new ObjectId().toString();
const makeRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

beforeEach(() => jest.clearAllMocks());

describe('POST /api/objective', () => {
  it('rejects a material from another course before creating anything', async () => {
    materialService.findMaterialsOutsideCourse.mockResolvedValue(['other-course-material']);
    const res = makeRes();

    await createObjectiveHandler(
      { user: { id: 'u1' }, body: { name: 'Explain buffers', courseId: COURSE, materialIds: ['mine', 'other-course-material'] } },
      res
    );

    expect(materialService.findMaterialsOutsideCourse).toHaveBeenCalledWith(['mine', 'other-course-material'], COURSE);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'MATERIAL_NOT_IN_COURSE' }));
    expect(objectiveService.createObjective).not.toHaveBeenCalled();
    expect(objectiveMaterialService.updateObjectiveMaterialRelations).not.toHaveBeenCalled();
  });

  it('creates and links when every material is in the course', async () => {
    materialService.findMaterialsOutsideCourse.mockResolvedValue([]);
    objectiveService.createObjective.mockResolvedValue({ parent: { _id: new ObjectId() }, granular: [] });
    const res = makeRes();

    await createObjectiveHandler(
      { user: { id: 'u1' }, body: { name: 'Explain buffers', courseId: COURSE, materialIds: ['mine'] } },
      res
    );

    expect(objectiveMaterialService.updateObjectiveMaterialRelations).toHaveBeenCalledWith(expect.any(String), ['mine']);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});

describe('PUT /api/objective/:id/materials', () => {
  it('rejects a material from another course and keeps the current links', async () => {
    objectiveService.getObjectiveCourseId.mockResolvedValue(new ObjectId(COURSE));
    materialService.findMaterialsOutsideCourse.mockResolvedValue(['other-course-material']);
    const res = makeRes();

    await updateObjectiveMaterials(
      { user: { id: 'u1' }, params: { id: new ObjectId().toString() }, body: { materialIds: ['other-course-material'] } },
      res
    );

    expect(materialService.findMaterialsOutsideCourse).toHaveBeenCalledWith(['other-course-material'], new ObjectId(COURSE));
    expect(res.status).toHaveBeenCalledWith(400);
    expect(objectiveMaterialService.updateObjectiveMaterialRelations).not.toHaveBeenCalled();
  });
});
