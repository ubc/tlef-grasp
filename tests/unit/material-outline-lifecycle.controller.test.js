jest.mock('../../src/services/material-outline', () => ({
  getOutline: jest.fn(),
  generateOutline: jest.fn(),
  saveOutline: jest.fn(),
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
jest.mock('../../src/services/course', () => ({
  getCourseById: jest.fn().mockResolvedValue({ courseName: 'Biology' }),
}));
jest.mock('../../src/services/settings', () => ({
  getSettings: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../src/services/rag', () => ({
  addDocumentToRAG: jest.fn().mockResolvedValue(['chunk-1']),
  deleteDocumentFromRAG: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../src/services/database', () => ({ connect: jest.fn() }));
jest.mock('../../src/utils/parse-in-worker', () => ({
  parseInWorker: jest.fn().mockResolvedValue({ content: 'Parsed text.', tokenUsage: 0 }),
}));

const outlineService = require('../../src/services/material-outline');
const materialService = require('../../src/services/material');
const { uploadFileHandler } = require('../../src/controllers/material');

const buildRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

const buildUploadReq = () => ({
  user: { id: 'user-1' },
  body: { courseId: 'course-1', documentTitle: 'Lecture 3' },
  file: {
    originalname: 'lecture.txt',
    mimetype: 'text/plain',
    buffer: Buffer.from('Some teachable content.'),
    size: 23,
  },
});

describe('outline generation at upload', () => {
  it('generates an outline after the material is stored', async () => {
    outlineService.generateOutline.mockResolvedValue({ outline: { topics: [], notes: '' } });
    const res = buildRes();

    await uploadFileHandler(buildUploadReq(), res);

    expect(materialService.saveMaterial).toHaveBeenCalled();
    expect(outlineService.generateOutline).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  // Losing a parsed and stored material because its summary failed would be a
  // bad trade; the instructor can generate it from the materials page instead.
  it('still succeeds when outline generation fails', async () => {
    outlineService.generateOutline.mockRejectedValue(new Error('model unavailable'));
    const res = buildRes();

    await uploadFileHandler(buildUploadReq(), res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    expect(res.status).not.toHaveBeenCalledWith(500);
  });
});
