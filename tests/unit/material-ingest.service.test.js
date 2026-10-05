// The shared step that turns a document file into a course material
// (src/services/material-ingest.js). File upload and the Canvas import both go
// through it, so what it does for one it does for the other.
jest.mock('../../src/services/material', () => ({
  saveMaterial: jest.fn(),
}));
jest.mock('../../src/services/course', () => ({
  getCourseById: jest.fn(),
}));
jest.mock('../../src/services/settings', () => ({
  getSettings: jest.fn(),
}));
jest.mock('../../src/services/rag', () => ({
  addDocumentToRAG: jest.fn(),
  deleteDocumentFromRAG: jest.fn(),
}));
jest.mock('../../src/services/material-outline', () => ({
  generateOutline: jest.fn(),
}));
jest.mock('../../src/utils/parse-in-worker', () => ({
  parseInWorker: jest.fn(),
}));
// The real one reads the environment; pin it so the assertions are exact.
jest.mock('../../src/utils/llm-effort', () => ({
  effortForStage: jest.fn(() => 'medium'),
}));

const { saveMaterial } = require('../../src/services/material');
const { getCourseById } = require('../../src/services/course');
const settingsService = require('../../src/services/settings');
const ragService = require('../../src/services/rag');
const outlineService = require('../../src/services/material-outline');
const { parseInWorker } = require('../../src/utils/parse-in-worker');
const { ingestMaterialFile } = require('../../src/services/material-ingest');
const {
  MAX_MATERIAL_FILE_BYTES,
  SUPPORTED_MATERIAL_MIME_TYPES,
  MaterialIngestError,
  materialFileKind,
  unsupportedTypeMessage,
} = require('../../src/utils/material-file-types');

const PDF = 'application/pdf';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

const file = (overrides = {}) => ({
  courseId: 'course-1',
  buffer: Buffer.from('file bytes'),
  fileName: 'Lecture 1.pdf',
  mimeType: PDF,
  size: 10,
  ...overrides,
});

describe('material file types', () => {
  it('caps a material file at 50 MB', () => {
    expect(MAX_MATERIAL_FILE_BYTES).toBe(50 * 1024 * 1024);
  });

  it('lists the MIME types of the four parseable formats', () => {
    expect(SUPPORTED_MATERIAL_MIME_TYPES).toEqual([PDF, DOCX, PPTX, 'text/plain']);
  });

  it.each([
    ['notes.pdf', PDF, 'pdf'],
    ['guide.docx', DOCX, 'docx'],
    ['slides.pptx', PPTX, 'pptx'],
    ['syllabus.txt', 'text/plain', 'txt'],
    // Either the MIME type or the extension is enough.
    ['Week 1 slides', PPTX, 'pptx'],
    ['SLIDES.PPTX', 'application/octet-stream', 'pptx'],
    ['readme.txt', undefined, 'txt'],
    ['notes', 'text/plain; charset=utf-8', 'txt'],
  ])('recognises %s (%s) as %s', (fileName, mimeType, kind) => {
    expect(materialFileKind({ fileName, mimeType })).toBe(kind);
  });

  it.each([
    ['diagram.png', 'image/png'],
    ['grades.csv', 'text/csv'],
    ['old.doc', 'application/msword'],
    ['old.ppt', 'application/vnd.ms-powerpoint'],
    ['', ''],
  ])('does not recognise %s (%s)', (fileName, mimeType) => {
    expect(materialFileKind({ fileName, mimeType })).toBeNull();
  });

  it('tells the owner of a legacy Office file to convert it', () => {
    expect(unsupportedTypeMessage({ fileName: 'old.doc' })).toMatch(/convert to DOCX, PDF, or PPTX/);
    expect(unsupportedTypeMessage({ mimeType: 'application/vnd.ms-powerpoint' })).toMatch(/convert to PPTX/);
    expect(unsupportedTypeMessage({ fileName: 'diagram.png', mimeType: 'image/png' }))
      .toBe('Unsupported file type. Supported file types are PDF, DOCX, PPTX, and TXT.');
  });
});

describe('ingestMaterialFile', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    getCourseById.mockResolvedValue({ courseName: 'Biochemistry' });
    settingsService.getSettings.mockResolvedValue({ prompts: { powerPointImageDescription: 'Describe {slideNumber}' } });
    parseInWorker.mockResolvedValue({ content: 'Parsed text.', tokenUsage: 12 });
    ragService.addDocumentToRAG.mockResolvedValue(['chunk-1']);
    ragService.deleteDocumentFromRAG.mockResolvedValue(undefined);
    saveMaterial.mockResolvedValue(undefined);
    outlineService.generateOutline.mockResolvedValue({ outline: { topics: [], notes: '' } });
  });

  afterEach(() => {
    console.log.mockRestore();
  });

  it('indexes, stores and outlines the extracted text under one source id', async () => {
    const result = await ingestMaterialFile(file({ sourceId: 'source-1', documentTitle: 'Week 1' }));

    expect(parseInWorker).toHaveBeenCalledWith('pdf', expect.any(Buffer), 'medium');
    expect(ragService.addDocumentToRAG).toHaveBeenCalledWith(
      'Parsed text.',
      {
        source: 'Lecture 1.pdf',
        type: 'file',
        course: 'Biochemistry',
        courseId: 'course-1',
        sourceId: 'source-1',
        documentTitle: 'Week 1',
      },
      'course-1'
    );
    expect(saveMaterial).toHaveBeenCalledWith('source-1', 'course-1', {
      fileType: PDF,
      fileSize: 10,
      fileContent: 'Parsed text.',
      documentTitle: 'Week 1',
    });
    expect(outlineService.generateOutline).toHaveBeenCalledWith('source-1');
    expect(result).toEqual({ sourceId: 'source-1', contentLength: 12, documentTitle: 'Week 1' });
  });

  it('generates a source id and titles the material after the file when neither is given', async () => {
    const result = await ingestMaterialFile(file());

    expect(result.sourceId).toMatch(/^course-1-\d+-0\.\d+$/);
    expect(result.documentTitle).toBe('Lecture 1.pdf');
    expect(saveMaterial).toHaveBeenCalledWith(
      result.sourceId, 'course-1', expect.objectContaining({ documentTitle: 'Lecture 1.pdf' })
    );
  });

  it('stores where an imported file came from, and nothing of the kind for an upload', async () => {
    const lms = { provider: 'canvas', externalCourseId: '42', externalFileId: '7001' };

    await ingestMaterialFile(file({ sourceId: 'imported', lms }));
    await ingestMaterialFile(file({ sourceId: 'uploaded' }));

    expect(saveMaterial.mock.calls[0][2].lms).toBe(lms);
    expect(saveMaterial.mock.calls[1][2]).not.toHaveProperty('lms');
  });

  it('parses a Word file by its type and stores the canonical MIME type', async () => {
    await ingestMaterialFile(file({ fileName: 'guide.docx', mimeType: 'application/octet-stream' }));

    expect(parseInWorker).toHaveBeenCalledWith('docx', expect.any(Buffer));
    expect(saveMaterial.mock.calls[0][2].fileType).toBe(DOCX);
  });

  it('parses a PowerPoint with the course\'s image-description prompt', async () => {
    await ingestMaterialFile(file({ fileName: 'Slides.pptx', mimeType: PPTX }));

    expect(parseInWorker).toHaveBeenCalledWith(
      'pptx', expect.any(Buffer), 'Slides.pptx', 'Describe {slideNumber}', 'medium'
    );
    expect(saveMaterial.mock.calls[0][2].fileType).toBe(PPTX);
  });

  it('reads a plain-text file directly', async () => {
    await ingestMaterialFile(file({ fileName: 'syllabus.txt', mimeType: 'text/plain', buffer: Buffer.from('Week 1: enzymes') }));

    expect(parseInWorker).not.toHaveBeenCalled();
    expect(saveMaterial.mock.calls[0][2]).toEqual(expect.objectContaining({
      fileType: 'text/plain',
      fileContent: 'Week 1: enzymes',
    }));
  });

  it.each([
    ['diagram.png', 'image/png', /Unsupported file type/],
    ['old.doc', 'application/msword', /DOC files are not fully supported/],
    ['old.ppt', 'application/vnd.ms-powerpoint', /PPT files are not fully supported/],
  ])('refuses %s before parsing or storing anything', async (fileName, mimeType, message) => {
    const attempt = ingestMaterialFile(file({ fileName, mimeType }));

    await expect(attempt).rejects.toBeInstanceOf(MaterialIngestError);
    await expect(attempt).rejects.toMatchObject({ code: 'unsupported-type', message: expect.stringMatching(message) });
    expect(parseInWorker).not.toHaveBeenCalled();
    expect(ragService.addDocumentToRAG).not.toHaveBeenCalled();
    expect(saveMaterial).not.toHaveBeenCalled();
  });

  it('refuses a file with no extractable text', async () => {
    parseInWorker.mockResolvedValue({ content: '   \n', tokenUsage: 0 });

    await expect(ingestMaterialFile(file())).rejects.toMatchObject({
      name: 'MaterialIngestError',
      code: 'empty-content',
      message: 'Could not extract content from file',
    });
    expect(ragService.addDocumentToRAG).not.toHaveBeenCalled();
    expect(saveMaterial).not.toHaveBeenCalled();
  });

  // Without this, a failed insert (for an import: losing the race for the
  // unique Canvas-file index) would leave retrievable chunks that belong to no
  // material an instructor can see or delete.
  it('removes the vector chunks again when the material cannot be stored', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    const duplicate = Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
    saveMaterial.mockRejectedValue(duplicate);

    await expect(ingestMaterialFile(file({ sourceId: 'source-1' }))).rejects.toBe(duplicate);
    consoleError.mockRestore();

    expect(ragService.deleteDocumentFromRAG).toHaveBeenCalledWith('source-1', 'course-1');
    expect(outlineService.generateOutline).not.toHaveBeenCalled();
  });

  it('keeps a material whose outline could not be generated', async () => {
    const consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    outlineService.generateOutline.mockRejectedValue(new Error('model unavailable'));

    const result = await ingestMaterialFile(file({ sourceId: 'source-1' }));
    consoleWarn.mockRestore();

    expect(result.sourceId).toBe('source-1');
    expect(ragService.deleteDocumentFromRAG).not.toHaveBeenCalled();
  });

  it('still parses when the course settings cannot be read', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    settingsService.getSettings.mockRejectedValue(new Error('database unavailable'));

    await ingestMaterialFile(file({ fileName: 'Slides.pptx', mimeType: PPTX }));
    consoleError.mockRestore();

    expect(parseInWorker).toHaveBeenCalledWith('pptx', expect.any(Buffer), 'Slides.pptx', undefined, null);
    expect(saveMaterial).toHaveBeenCalled();
  });
});
