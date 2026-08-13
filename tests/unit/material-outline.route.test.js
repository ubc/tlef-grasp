jest.mock('../../src/services/material-outline', () => ({
  getOutline: jest.fn(),
  generateOutline: jest.fn(),
}));
jest.mock('../../src/services/material', () => ({
  saveMaterial: jest.fn(),
  getCourseMaterials: jest.fn(),
  getMaterialCourseId: jest.fn().mockResolvedValue('course-1'),
  deleteMaterial: jest.fn(),
  getMaterialBySourceId: jest.fn(),
  setMaterialOutline: jest.fn(),
  clearMaterialOutline: jest.fn(),
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
jest.mock('../../src/services/course', () => ({ getCourseById: jest.fn() }));
jest.mock('../../src/services/settings', () => ({ getSettings: jest.fn() }));
jest.mock('../../src/services/rag', () => ({
  addDocumentToRAG: jest.fn(),
  deleteDocumentFromRAG: jest.fn(),
}));
jest.mock('../../src/services/database', () => ({ connect: jest.fn() }));
jest.mock('../../src/utils/parse-in-worker', () => ({ parseInWorker: jest.fn() }));

const outlineService = require('../../src/services/material-outline');
const materialService = require('../../src/services/material');
const courseAccess = require('../../src/utils/course-access');
const {
  getMaterialOutlineHandler,
  generateMaterialOutlineHandler,
  getCourseMaterialsHandler,
} = require('../../src/controllers/material');

const RESULT = {
  outline: { topics: [{ title: 'T', keyPoints: ['p'] }], notes: '' },
  source: 'generated',
  generatedAt: new Date('2026-08-01'),
  editedAt: null,
  stale: false,
};

const buildRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};
const buildReq = (overrides = {}) => ({
  params: { sourceId: 'src-1' },
  user: { id: 'user-1' },
  body: {},
  ...overrides,
});

describe('GET outline', () => {
  it('returns the stored outline', async () => {
    outlineService.getOutline.mockResolvedValue(RESULT);
    const res = buildRes();

    await getMaterialOutlineHandler(buildReq(), res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, source: 'generated' })
    );
  });

  it('404s when there is no outline', async () => {
    outlineService.getOutline.mockResolvedValue(null);
    const res = buildRes();

    await getMaterialOutlineHandler(buildReq(), res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('403s without staff access', async () => {
    courseAccess.hasStaffAccessInCourse.mockResolvedValueOnce(false);
    const res = buildRes();

    await getMaterialOutlineHandler(buildReq(), res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(outlineService.getOutline).not.toHaveBeenCalled();
  });
});

describe('POST outline', () => {
  it('generates and returns the outline', async () => {
    outlineService.generateOutline.mockResolvedValue(RESULT);
    const res = buildRes();

    await generateMaterialOutlineHandler(buildReq(), res);

    expect(outlineService.generateOutline).toHaveBeenCalledWith('src-1');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('400s when the material has no text', async () => {
    outlineService.generateOutline.mockRejectedValue(
      Object.assign(new Error('nothing to summarize'), { code: 'EMPTY_MATERIAL' })
    );
    const res = buildRes();

    await generateMaterialOutlineHandler(buildReq(), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'EMPTY_MATERIAL' })
    );
  });

  it('403s without staff access', async () => {
    courseAccess.hasStaffAccessInCourse.mockResolvedValueOnce(false);
    const res = buildRes();

    await generateMaterialOutlineHandler(buildReq(), res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(outlineService.generateOutline).not.toHaveBeenCalled();
  });
});

describe('materials list', () => {
  // The list is already oversized; shipping every topic list to render a button
  // would repeat that mistake.
  it('reports hasOutline and never includes the outline itself', async () => {
    materialService.getCourseMaterials.mockResolvedValue([
      { sourceId: 'a', outline: { topics: [], notes: '' }, documentTitle: 'Lecture 3' },
      { sourceId: 'b' },
    ]);
    const res = buildRes();

    await getCourseMaterialsHandler(
      { params: { courseId: 'course-1' }, user: { id: 'u' } },
      res
    );

    const { materials } = res.json.mock.calls[0][0];
    expect(materials[0].hasOutline).toBe(true);
    expect(materials[0].documentTitle).toBe('Lecture 3');
    expect(materials[0].outline).toBeUndefined();
    expect(materials[1].hasOutline).toBe(false);
  });
});
