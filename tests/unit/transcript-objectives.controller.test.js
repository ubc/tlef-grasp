// Learning objectives from a Panopto transcript (issue #218): which materials
// may be read, what the model is sent, and what comes back. Nothing is saved
// by this endpoint, so no objective service is involved.

const mockGenerateStructured = jest.fn();
const mockGetMaterialBySourceId = jest.fn();
const mockGetOutline = jest.fn();
const mockGetSettings = jest.fn();
const mockHasStaffAccessInCourse = jest.fn();
const mockAssertCoInstructorPermission = jest.fn();
const mockAssertTaPermission = jest.fn();

jest.mock('../../src/utils/structured-llm', () => ({ generateStructured: mockGenerateStructured }));
jest.mock('../../src/services/material', () => ({ getMaterialBySourceId: mockGetMaterialBySourceId }));
jest.mock('../../src/services/material-outline', () => ({ getOutline: mockGetOutline }));
jest.mock('../../src/services/settings', () => ({ getSettings: mockGetSettings }));
jest.mock('../../src/utils/course-access', () => ({ hasStaffAccessInCourse: mockHasStaffAccessInCourse }));
jest.mock('../../src/utils/co-instructor-permissions', () => ({
  assertCoInstructorPermission: mockAssertCoInstructorPermission,
  PERMISSION_KEYS: { QUESTION_GENERATION: 'questionGeneration' },
}));
jest.mock('../../src/utils/ta-permissions', () => ({
  assertTaPermission: mockAssertTaPermission,
  TA_PERMISSION_KEYS: { QUESTION_GENERATION: 'questionGeneration' },
}));

const {
  generateTranscriptObjectivesHandler,
  buildTranscriptObjectivesPrompt,
} = require('../../src/controllers/transcript-objectives');
const {
  DEFAULT_PROMPTS,
  OBJECTIVE_GENERATION_TRANSCRIPT_PROMPT,
  TRANSCRIPT_OBJECTIVES_MAX_CHARS,
} = require('../../src/constants/app-constants');

const COURSE_ID = '64b000000000000000000001';
const TRANSCRIPT = 'Today we look at Michaelis-Menten kinetics. Km is the substrate concentration at half Vmax.';

const transcriptMaterial = (overrides = {}) => ({
  sourceId: 'material-1',
  courseId: { toString: () => COURSE_ID },
  documentTitle: 'Lecture 4: Enzyme kinetics',
  fileContent: TRANSCRIPT,
  lms: { provider: 'panopto', externalFileId: 'session-1' },
  ...overrides,
});

const relevantResponse = {
  materialIsRelevant: true,
  relevanceReason: 'Teaches enzyme kinetics.',
  objectives: [
    {
      name: 'Describe Michaelis-Menten kinetics',
      granularObjectives: [
        {
          text: 'Define Km in terms of Vmax',
          bloomTaxonomies: ['Remember', 'Nonsense'],
          questionTypes: [{ bloomLevel: 'Remember', questionType: 'fill-in-the-blank', count: 1 }],
        },
        { text: '   ', bloomTaxonomies: ['Apply'], questionTypes: [] },
      ],
    },
    { name: '', granularObjectives: [{ text: 'Orphan', bloomTaxonomies: [], questionTypes: [] }] },
  ],
};

const buildRequest = (body = {}) => ({
  user: { _id: 'user-1' },
  body: { courseId: COURSE_ID, courseName: 'BIOC 302', materialId: 'material-1', ...body },
});

const buildResponse = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  res.set = jest.fn(() => res);
  return res;
};

const sentPrompt = () => mockGenerateStructured.mock.calls[0][0].prompt;

beforeEach(() => {
  jest.clearAllMocks();
  mockHasStaffAccessInCourse.mockResolvedValue(true);
  mockAssertCoInstructorPermission.mockResolvedValue(true);
  mockAssertTaPermission.mockResolvedValue(true);
  mockGetSettings.mockResolvedValue({ prompts: {}, reasoningEffort: {} });
  mockGetMaterialBySourceId.mockResolvedValue(transcriptMaterial());
  mockGenerateStructured.mockResolvedValue({ content: JSON.stringify(relevantResponse), usage: {} });
});

describe('the transcript prompt', () => {
  it('is a default course prompt with the placeholders the Settings page lists', () => {
    expect(DEFAULT_PROMPTS.objectiveGenerationTranscript).toBe(OBJECTIVE_GENERATION_TRANSCRIPT_PROMPT);
    for (const placeholder of ['{courseName}', '{videoTitle}', '{transcript}']) {
      expect(OBJECTIVE_GENERATION_TRANSCRIPT_PROMPT).toContain(placeholder);
    }
  });

  it('fills each placeholder once, leaving placeholder-like text and $ sequences in the values alone', () => {
    const prompt = buildTranscriptObjectivesPrompt('{courseName} | {videoTitle} | {transcript} | {courseName}', {
      courseName: 'Course {transcript}',
      videoTitle: 'Video $& $1',
      transcript: 'Energy $$E = mc^2$$ {videoTitle}',
    });
    expect(prompt).toBe(
      'Course {transcript} | Video $& $1 | Energy $$E = mc^2$$ {videoTitle} | Course {transcript}'
    );
  });
});

describe('generateTranscriptObjectivesHandler', () => {
  it('sends the whole transcript through the transcript prompt and returns cleaned objectives', async () => {
    const res = buildResponse();
    await generateTranscriptObjectivesHandler(buildRequest(), res);

    expect(mockGenerateStructured).toHaveBeenCalledTimes(1);
    expect(mockGenerateStructured.mock.calls[0][0]).toMatchObject({ operation: 'objective-generate' });
    const prompt = sentPrompt();
    expect(prompt).toContain('LECTURE TRANSCRIPT:');
    expect(prompt).toContain(TRANSCRIPT);
    expect(prompt).toContain('COURSE: BIOC 302');
    expect(prompt).toContain('RECORDING: Lecture 4: Enzyme kinetics');
    expect(prompt).not.toMatch(/\{(courseName|videoTitle|transcript)\}/);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      usedOutline: false,
      objectives: [
        {
          name: 'Describe Michaelis-Menten kinetics',
          granularObjectives: [
            {
              text: 'Define Km in terms of Vmax',
              bloomTaxonomies: ['Remember'],
              questionTypes: [{ bloomLevel: 'Remember', questionType: 'fill-in-the-blank', count: 1 }],
            },
          ],
        },
      ],
    });
  });

  it("uses the course's own transcript prompt when it has one", async () => {
    mockGetSettings.mockResolvedValue({
      prompts: { objectiveGenerationTranscript: 'MINE {videoTitle} :: {transcript}' },
    });
    await generateTranscriptObjectivesHandler(buildRequest(), buildResponse());
    expect(sentPrompt()).toBe(`MINE Lecture 4: Enzyme kinetics :: ${TRANSCRIPT}`);
  });

  it('reads the outline instead when the transcript is too long to send whole', async () => {
    mockGetMaterialBySourceId.mockResolvedValue(
      transcriptMaterial({ fileContent: 'x'.repeat(TRANSCRIPT_OBJECTIVES_MAX_CHARS + 1) })
    );
    mockGetOutline.mockResolvedValue({
      outline: { topics: [{ title: 'Enzyme kinetics', keyPoints: ['Km and Vmax'] }], notes: '' },
    });
    const res = buildResponse();
    await generateTranscriptObjectivesHandler(buildRequest(), res);

    expect(mockGetOutline).toHaveBeenCalledWith('material-1');
    expect(sentPrompt()).toContain('Below is an outline of its full transcript');
    expect(sentPrompt()).toContain('## Enzyme kinetics');
    expect(sentPrompt()).not.toContain('xxxxxxxx');
    expect(res.json.mock.calls[0][0]).toMatchObject({ success: true, usedOutline: true });
  });

  it('refuses a too-long transcript that has no outline, without calling the model', async () => {
    mockGetMaterialBySourceId.mockResolvedValue(
      transcriptMaterial({ fileContent: 'x'.repeat(TRANSCRIPT_OBJECTIVES_MAX_CHARS + 1) })
    );
    mockGetOutline.mockResolvedValue(null);
    const res = buildResponse();
    await generateTranscriptObjectivesHandler(buildRequest(), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0]).toMatchObject({ code: 'TRANSCRIPT_TOO_LONG' });
    expect(mockGenerateStructured).not.toHaveBeenCalled();
  });

  it('refuses an empty transcript', async () => {
    mockGetMaterialBySourceId.mockResolvedValue(transcriptMaterial({ fileContent: '  \n ' }));
    const res = buildResponse();
    await generateTranscriptObjectivesHandler(buildRequest(), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0]).toMatchObject({ code: 'EMPTY_TRANSCRIPT' });
    expect(mockGenerateStructured).not.toHaveBeenCalled();
  });

  it("refuses a material from another course as if it did not exist", async () => {
    mockGetMaterialBySourceId.mockResolvedValue(
      transcriptMaterial({ courseId: { toString: () => '64b000000000000000000999' } })
    );
    const res = buildResponse();
    await generateTranscriptObjectivesHandler(buildRequest(), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json.mock.calls[0][0]).toMatchObject({ code: 'MATERIAL_NOT_FOUND' });
    expect(mockGenerateStructured).not.toHaveBeenCalled();
  });

  it('refuses a material that did not come from Panopto', async () => {
    mockGetMaterialBySourceId.mockResolvedValue(transcriptMaterial({ lms: { provider: 'canvas' } }));
    const res = buildResponse();
    await generateTranscriptObjectivesHandler(buildRequest(), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0]).toMatchObject({ code: 'NOT_A_TRANSCRIPT' });
    expect(mockGenerateStructured).not.toHaveBeenCalled();
  });

  it('needs a course and a material id', async () => {
    const res = buildResponse();
    await generateTranscriptObjectivesHandler(buildRequest({ materialId: '' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockGetMaterialBySourceId).not.toHaveBeenCalled();
  });

  it('turns away someone without staff access to the course before reading anything', async () => {
    mockHasStaffAccessInCourse.mockResolvedValue(false);
    const res = buildResponse();
    await generateTranscriptObjectivesHandler(buildRequest(), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockGetMaterialBySourceId).not.toHaveBeenCalled();
  });

  it('stops when a co-instructor or TA lacks question generation', async () => {
    // The permission helper writes its own 403 and answers false.
    mockAssertTaPermission.mockResolvedValue(false);
    const res = buildResponse();
    await generateTranscriptObjectivesHandler(buildRequest(), res);
    expect(mockAssertTaPermission).toHaveBeenCalledWith(
      expect.anything(), res, COURSE_ID, 'questionGeneration'
    );
    expect(mockGetMaterialBySourceId).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it('reports a recording that teaches nothing as a 422 with the reason', async () => {
    mockGenerateStructured.mockResolvedValue({
      content: JSON.stringify({
        materialIsRelevant: false,
        relevanceReason: 'Only course logistics are discussed.',
        objectives: [],
      }),
    });
    const res = buildResponse();
    await generateTranscriptObjectivesHandler(buildRequest(), res);
    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      code: 'MATERIAL_NOT_RELEVANT',
      details: 'Only course logistics are discussed.',
    });
  });

  it('fails cleanly when the model returns nothing usable', async () => {
    mockGenerateStructured.mockResolvedValue({
      content: JSON.stringify({ materialIsRelevant: true, relevanceReason: '', objectives: [] }),
    });
    const res = buildResponse();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await generateTranscriptObjectivesHandler(buildRequest(), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0]).toMatchObject({ success: false });
    console.error.mockRestore();
  });

  it('answers 429 with Retry-After when the AI provider rate limits', async () => {
    mockGenerateStructured.mockRejectedValue(
      Object.assign(new Error('Too many requests'), { status: 429, headers: { 'retry-after': '12' } })
    );
    const res = buildResponse();
    await generateTranscriptObjectivesHandler(buildRequest(), res);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.set).toHaveBeenCalledWith('Retry-After', '12');
    expect(res.json.mock.calls[0][0]).toMatchObject({ rateLimited: true, retryAfterSeconds: 12 });
  });
});
