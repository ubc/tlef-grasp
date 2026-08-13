/**
 * H3: editing or refetching a material must not be able to destroy it.
 *
 * saveMaterial inserts and sourceId is uniquely indexed, so a content change is a
 * delete-then-reinsert. That made the sequence destructive: the Mongo row was
 * deleted, then addDocumentToRAG ran, and if it threw — Qdrant restarting, the
 * embedding provider rate-limiting, a network blip — the request 500'd with the
 * row already gone and never re-inserted. The extracted text exists nowhere else,
 * so an instructor fixing a typo could permanently lose the material, its
 * outline, and every objective link pointing at it.
 */

jest.mock('../../src/services/material', () => ({
  saveMaterial: jest.fn(),
  deleteMaterial: jest.fn(),
  restoreMaterialDocument: jest.fn(),
  getMaterialBySourceId: jest.fn(),
  getMaterialCourseId: jest.fn(),
  getCourseMaterials: jest.fn(),
  clearMaterialOutline: jest.fn(),
  setMaterialOutline: jest.fn(),
}));
jest.mock('../../src/services/rag', () => ({
  addDocumentToRAG: jest.fn(),
  deleteDocumentFromRAG: jest.fn(),
}));
jest.mock('../../src/services/material-outline', () => ({
  generateOutline: jest.fn(),
  getOutline: jest.fn(),
}));
jest.mock('../../src/utils/safe-fetch-url', () => ({
  fetchReadableText: jest.fn(),
  BlockedUrlError: class BlockedUrlError extends Error {},
}));
jest.mock('../../src/utils/course-access', () => ({
  hasStaffAccessInCourse: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../src/utils/co-instructor-permissions', () => ({
  assertCoInstructorPermission: jest.fn().mockResolvedValue(true),
  PERMISSION_KEYS: { COURSE_MATERIALS: 'courseMaterials', QUESTION_GENERATION: 'questionGeneration' },
}));
jest.mock('../../src/utils/ta-permissions', () => ({
  assertTaPermission: jest.fn().mockResolvedValue(true),
  TA_PERMISSION_KEYS: { COURSE_MATERIALS: 'courseMaterials', QUESTION_GENERATION: 'questionGeneration' },
}));
jest.mock('../../src/services/course', () => ({
  getCourseById: jest.fn().mockResolvedValue({ courseName: 'CHEM 121' }),
}));
jest.mock('../../src/services/settings', () => ({ getSettings: jest.fn() }));
jest.mock('../../src/services/database', () => ({ connect: jest.fn() }));
jest.mock('../../src/utils/parse-in-worker', () => ({ parseInWorker: jest.fn() }));

const materialService = require('../../src/services/material');
const ragService = require('../../src/services/rag');
const { updateMaterialHandler, refetchMaterialHandler } = require('../../src/controllers/material');

// The stored document, as it exists before the edit. Its fileContent is the only
// copy of the extracted text.
const STORED = {
  _id: 'mongo-id-1',
  sourceId: 'source-1',
  courseId: 'course-1',
  fileType: 'text/plain',
  fileSize: 42,
  fileContent: 'The original extracted lecture text.',
  documentTitle: 'Lecture 3',
  createdAt: new Date('2026-01-01'),
  outline: { topics: [{ title: 'T', keyPoints: ['p'] }], notes: '' },
};

const makeRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

let consoleErrorSpy;
let consoleWarnSpy;

beforeAll(() => {
  consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterAll(() => {
  jest.restoreAllMocks();
});

beforeEach(() => {
  materialService.getMaterialBySourceId.mockResolvedValue({ ...STORED });
  ragService.deleteDocumentFromRAG.mockResolvedValue(undefined);
  ragService.addDocumentToRAG.mockResolvedValue(['chunk-1']);
  materialService.deleteMaterial.mockResolvedValue(undefined);
  materialService.saveMaterial.mockResolvedValue(undefined);
  materialService.restoreMaterialDocument.mockResolvedValue(undefined);
});

const textEditRequest = () => ({
  body: {
    sourceId: 'source-1',
    courseId: 'course-1',
    documentType: 'text',
    documentData: { textContent: 'Revised lecture text.' },
    documentTitle: 'Lecture 3',
  },
  user: { id: 'u1' },
  params: {},
});

describe('updateMaterialHandler content swap', () => {
  it('replaces the material when every step succeeds, without restoring', async () => {
    const res = makeRes();

    await updateMaterialHandler(textEditRequest(), res);

    expect(materialService.deleteMaterial).toHaveBeenCalledWith('source-1');
    expect(materialService.saveMaterial).toHaveBeenCalledWith(
      'source-1',
      'course-1',
      expect.objectContaining({ fileContent: 'Revised lecture text.' })
    );
    expect(materialService.restoreMaterialDocument).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('restores the original document when the vector write fails', async () => {
    ragService.addDocumentToRAG.mockRejectedValueOnce(new Error('Qdrant unavailable'));
    const res = makeRes();

    await updateMaterialHandler(textEditRequest(), res);

    // The row was deleted, so it must be put back byte-for-byte — _id, createdAt
    // and the outline included, not just the text.
    expect(materialService.restoreMaterialDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: 'mongo-id-1',
        sourceId: 'source-1',
        fileContent: 'The original extracted lecture text.',
        createdAt: STORED.createdAt,
        outline: STORED.outline,
      })
    );
    // And the edit is reported as failed rather than silently swallowed.
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('restores the original document when the re-insert fails', async () => {
    materialService.saveMaterial.mockRejectedValueOnce(new Error('E11000 duplicate key'));
    const res = makeRes();

    await updateMaterialHandler(textEditRequest(), res);

    expect(materialService.restoreMaterialDocument).toHaveBeenCalledWith(
      expect.objectContaining({ fileContent: 'The original extracted lecture text.' })
    );
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('does not clear the outline when the swap failed and rolled back', async () => {
    ragService.addDocumentToRAG.mockRejectedValueOnce(new Error('Qdrant unavailable'));
    const res = makeRes();

    await updateMaterialHandler(textEditRequest(), res);

    // The restored outline still describes the restored text, so it must survive.
    expect(materialService.clearMaterialOutline).not.toHaveBeenCalled();
  });

  it('tolerates a failed vector delete, since the add rewrites those chunks', async () => {
    ragService.deleteDocumentFromRAG.mockRejectedValueOnce(new Error('collection missing'));
    const res = makeRes();

    await updateMaterialHandler(textEditRequest(), res);

    expect(materialService.saveMaterial).toHaveBeenCalled();
    expect(materialService.restoreMaterialDocument).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('attempts to put the original chunks back after a rollback', async () => {
    ragService.addDocumentToRAG
      .mockRejectedValueOnce(new Error('Qdrant unavailable')) // the new content
      .mockResolvedValueOnce(['restored-chunk']); // the rollback re-add
    const res = makeRes();

    await updateMaterialHandler(textEditRequest(), res);

    expect(ragService.addDocumentToRAG).toHaveBeenLastCalledWith(
      'The original extracted lecture text.',
      expect.objectContaining({ sourceId: 'source-1' }),
      'course-1'
    );
  });

  it('still restores the document when the rollback chunk re-add also fails', async () => {
    ragService.addDocumentToRAG.mockRejectedValue(new Error('Qdrant unavailable'));
    const res = makeRes();

    await updateMaterialHandler(textEditRequest(), res);

    expect(materialService.restoreMaterialDocument).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
  });

  // A rename never touches content, so it must not go near the swap at all.
  it('leaves an uploaded file rename out of the swap path entirely', async () => {
    require('../../src/services/database').connect.mockResolvedValue({
      collection: () => ({ updateOne: jest.fn().mockResolvedValue({}) }),
    });
    const res = makeRes();

    await updateMaterialHandler(
      {
        body: {
          sourceId: 'source-1',
          courseId: 'course-1',
          documentType: 'pdf',
          documentData: { anything: true },
          documentTitle: 'Renamed',
        },
        user: { id: 'u1' },
        params: {},
      },
      res
    );

    expect(materialService.deleteMaterial).not.toHaveBeenCalled();
    expect(ragService.addDocumentToRAG).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});

describe('refetchMaterialHandler content swap', () => {
  const refetchRequest = () => ({
    body: {
      sourceId: 'source-1',
      courseId: 'course-1',
      url: 'https://example.com/lecture',
      content: 'Freshly fetched page text.',
    },
    user: { id: 'u1' },
    params: {},
  });

  it('replaces the link content when every step succeeds', async () => {
    const res = makeRes();

    await refetchMaterialHandler(refetchRequest(), res);

    expect(materialService.saveMaterial).toHaveBeenCalled();
    expect(materialService.restoreMaterialDocument).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('restores the original document when the vector write fails', async () => {
    ragService.addDocumentToRAG.mockRejectedValueOnce(new Error('Qdrant unavailable'));
    const res = makeRes();

    await refetchMaterialHandler(refetchRequest(), res);

    expect(materialService.restoreMaterialDocument).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: 'source-1', _id: 'mongo-id-1' })
    );
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
