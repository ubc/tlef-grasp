const mockGenerateStructured = jest.fn();
const mockGetExistingQuestionTexts = jest.fn();

jest.mock('../../src/services/rag', () => ({
  getLearningObjectiveRagContent: jest.fn().mockResolvedValue('Relevant material'),
}));
jest.mock('../../src/services/llm', () => ({ isReady: jest.fn(() => true) }));
jest.mock('../../src/services/question', () => ({
  getQuestionTextsByGranularObjective: mockGetExistingQuestionTexts,
}));
jest.mock('../../src/services/settings', () => ({
  getSettings: jest.fn().mockResolvedValue(null),
}));
// generateQuestionsWithRagHandler now checks course membership before the
// capability guards (H6) — those two fail open for a non-member, so neither
// substituted for it.
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
jest.mock('../../src/utils/llm-provider', () => ({
  getLLMModel: jest.fn(() => 'test-model'),
  getReviewModel: jest.fn(() => 'test-review-model'),
  getLLMProvider: jest.fn(() => 'openai'),
}));
jest.mock('../../src/utils/structured-llm', () => ({
  generateStructured: mockGenerateStructured,
}));

const ragService = require('../../src/services/rag');
const { generateQuestionsWithRagHandler } = require('../../src/controllers/rag-llm');

const makeMcq = (question, correctAnswer = 'A') => ({
  scratchwork: 'Checked the answer.',
  question,
  options: {
    A: { text: 'Option A', feedback: correctAnswer === 'A' ? '' : 'Not A.' },
    B: { text: 'Option B', feedback: correctAnswer === 'B' ? '' : 'Not B.' },
    C: { text: 'Option C', feedback: correctAnswer === 'C' ? '' : 'Not C.' },
    D: { text: 'Option D', feedback: correctAnswer === 'D' ? '' : 'Not D.' },
  },
  correctAnswer,
  explanation: 'Because the correct option is correct.',
});

const makeReviewResponse = (ratings) => ({
  content: JSON.stringify({ ratings }),
  usage: {},
});

const cleanRating = (id = '0') => ({
  questionId: id,
  reasoning: 'Recomputed independently; matches the stated answer.',
  flagged: false,
  issue: '',
});

const flaggedRating = (id = '0', issue = 'The stated correct answer is wrong.') => ({
  questionId: id,
  reasoning: 'Recomputed independently; does not match the stated answer.',
  flagged: true,
  issue,
});

const buildRequest = () => ({
  body: {
    courseId: 'course-1',
    courseName: 'Biology',
    learningObjectiveId: 'objective-1',
    learningObjectiveText: 'Explain cellular energy',
    granularLearningObjectiveId: 'granular-1',
    granularLearningObjectiveText: 'Explain ATP production',
    bloomLevels: ['Understand'],
    count: 1,
  },
});

const buildResponse = () => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn().mockReturnThis(),
});

describe('generateQuestionsWithRagHandler duplicate protection', () => {
  beforeEach(() => {
    mockGenerateStructured.mockReset();
    mockGetExistingQuestionTexts.mockReset();
    mockGetExistingQuestionTexts.mockResolvedValue(['What is ATP?']);
  });

  it('includes existing granular-objective questions and retries an exact duplicate', async () => {
    mockGenerateStructured
      .mockResolvedValueOnce({ content: JSON.stringify(makeMcq('  WHAT  IS ATP? ')), usage: {} })
      .mockResolvedValueOnce({ content: JSON.stringify(makeMcq('How does ATP power transport?')), usage: {} })
      .mockResolvedValueOnce(makeReviewResponse([cleanRating('0')]));
    const res = buildResponse();

    await generateQuestionsWithRagHandler(buildRequest(), res);

    expect(mockGetExistingQuestionTexts).toHaveBeenCalledWith('course-1', 'granular-1');
    // 2 generation attempts (duplicate retry + success) + 1 initial review
    // call, which comes back clean so no fix cycle runs. No planning call: a
    // single-question batch has no coverage to plan.
    expect(mockGenerateStructured).toHaveBeenCalledTimes(3);
    // The existing-question list rides in the shared prefix, so every request
    // in the batch gets it without any of them re-sending it.
    expect(mockGenerateStructured.mock.calls[0][0].messages[0].content).toContain(
      '1. What is ATP?'
    );
    expect(mockGenerateStructured.mock.calls[1][0].messages[0].content).toContain(
      '1. What is ATP?'
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        questions: [
          expect.objectContaining({
            question: 'How does ATP power transport?',
            reviewFlag: false,
          }),
        ],
      })
    );
  });

  it('never returns a duplicate when every retry repeats it', async () => {
    mockGenerateStructured
      .mockResolvedValue({
        content: JSON.stringify(makeMcq('What is ATP?')),
        usage: {},
      });
    const res = buildResponse();

    await generateQuestionsWithRagHandler(buildRequest(), res);

    // 3 exhausted generation attempts. No review runs — there is nothing to
    // review.
    expect(mockGenerateStructured).toHaveBeenCalledTimes(3);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false })
    );
  });
});

describe('generateQuestionsWithRagHandler review-fix loop', () => {
  beforeEach(() => {
    mockGenerateStructured.mockReset();
    mockGetExistingQuestionTexts.mockReset();
    mockGetExistingQuestionTexts.mockResolvedValue([]);
  });

  it('fixes a flagged question with a targeted patch and clears the flag once re-review passes', async () => {
    mockGenerateStructured
      // generation succeeds on the first attempt
      .mockResolvedValueOnce({
        content: JSON.stringify(makeMcq('What is ATP?', 'A')),
        usage: { promptTokens: 1000, completionTokens: 200 },
      })
      // initial review flags it
      .mockResolvedValueOnce({
        ...makeReviewResponse([flaggedRating('0', 'Option A is not actually correct.')]),
        usage: { promptTokens: 300, completionTokens: 50 },
      })
      // fix attempt produces a corrected answer
      .mockResolvedValueOnce({
        content: JSON.stringify(makeMcq('What is ATP?', 'B')),
        usage: { promptTokens: 900, completionTokens: 150 },
      })
      // re-review of just the fixed question comes back clean
      .mockResolvedValueOnce({
        ...makeReviewResponse([cleanRating('0')]),
        usage: { promptTokens: 250, completionTokens: 40 },
      });
    const res = buildResponse();
    // Fisher-Yates over 4 options makes exactly 3 Math.random() calls per
    // scramble. If a question were scrambled again after review/fix (the bug
    // this guards against — where a reviewer's issue text, or an
    // already-fixed question, would name/hold a letter that no longer
    // matches what ships), this count would be higher than "one scramble per
    // question produced" (original generation + the one successful fix = 2).
    const randomSpy = jest.spyOn(Math, 'random');

    await generateQuestionsWithRagHandler(buildRequest(), res);

    expect(randomSpy).toHaveBeenCalledTimes(6);
    randomSpy.mockRestore();

    // The "scramble the generated options" step runs immediately when the
    // question (and separately, the fix) is produced — never again after —
    // so the question's own fix context, the reviewer's issue text, and what
    // ships all agree on the same lettering throughout. That still means
    // correctAnswer's *letter* isn't deterministic in this test (each scramble
    // is random); assert on content instead — the option holding the fix's
    // chosen answer ("Option B") must be the one marked correct, whichever
    // letter that is.
    // 1 generation + 1 review + 1 fix + 1 re-review.
    expect(mockGenerateStructured).toHaveBeenCalledTimes(4);
    expect(res.json).toHaveBeenCalledTimes(1);
    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.questions).toHaveLength(1);
    const fixedQuestion = payload.questions[0];
    expect(['A', 'B', 'C', 'D']).toContain(fixedQuestion.correctAnswer);
    expect(fixedQuestion.options[fixedQuestion.correctAnswer].text).toBe('Option B');
    expect(fixedQuestion.wasAutoFixed).toBe(true);
    expect(fixedQuestion.reviewFlag).toBe(false);
    expect(fixedQuestion.reviewIssue).toBe('');
    expect(fixedQuestion.autoFixReason).toContain('Option A is not actually correct.');

    // tokenUsage is broken out by stage so the review-fix loop's cost is
    // visible separately from generation's — this is the whole point of the
    // breakdown (letting callers compute the loop's cost delta, not just a
    // single opaque total).
    expect(payload.tokenUsage.generation).toEqual({ promptTokens: 1000, completionTokens: 200 });
    expect(payload.tokenUsage.review).toEqual({ promptTokens: 550, completionTokens: 90 });
    expect(payload.tokenUsage.fix).toEqual({ promptTokens: 900, completionTokens: 150 });
    expect(payload.tokenUsage.total).toEqual({ promptTokens: 2450, completionTokens: 440 });
  });

  it('scrambles a never-flagged question exactly once', async () => {
    mockGenerateStructured
      .mockResolvedValueOnce({ content: JSON.stringify(makeMcq('What is ATP?')), usage: {} })
      .mockResolvedValueOnce(makeReviewResponse([cleanRating('0')]));
    const res = buildResponse();
    const randomSpy = jest.spyOn(Math, 'random');

    await generateQuestionsWithRagHandler(buildRequest(), res);

    // Exactly one scramble (3 Math.random() calls for a 4-option Fisher-Yates)
    // at generation time; nothing should scramble it again after review.
    expect(randomSpy).toHaveBeenCalledTimes(3);
    randomSpy.mockRestore();
  });

  it('ships a question still flagged after the last fix cycle if every attempt fails validation', async () => {
    mockGenerateStructured
      .mockResolvedValueOnce({ content: JSON.stringify(makeMcq('What is ATP?')), usage: {} })
      .mockResolvedValueOnce(makeReviewResponse([flaggedRating('0')]))
      // cycle 1: both fix attempts return unparseable content
      .mockResolvedValueOnce({ content: 'not valid json', usage: {} })
      .mockResolvedValueOnce({ content: 'still not valid json', usage: {} })
      // cycle 2: the same
      .mockResolvedValueOnce({ content: 'not valid json', usage: {} })
      .mockResolvedValueOnce({ content: 'still not valid json', usage: {} });
    const res = buildResponse();

    await generateQuestionsWithRagHandler(buildRequest(), res);

    // 1 generation + 1 initial review + 2 cycles x 2 fix attempts = 6.
    // No re-review calls: a fix attempt that never produces valid output never
    // reaches the "patched" set, so nothing is re-reviewed — this is the
    // existing ship-with-flag behavior, not a new failure mode.
    expect(mockGenerateStructured).toHaveBeenCalledTimes(6);
    expect(res.json).toHaveBeenCalledTimes(1);
    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.questions).toHaveLength(1);
    expect(payload.questions[0].reviewFlag).toBe(true);
    expect(payload.questions[0].wasAutoFixed).toBeFalsy();
  });
});

describe('generateQuestionsWithRagHandler prompt interpolation', () => {
  beforeEach(() => {
    mockGenerateStructured.mockReset();
    mockGetExistingQuestionTexts.mockResolvedValue([]);
  });

  // String.replace() interprets `$$`, `$&` and `` $` `` inside a replacement
  // string. Calculation questions are generated from math-heavy material, so
  // interpolating it as a plain string corrupted the LaTeX before the model
  // ever saw it: "$$E = mc^2$$" arrived as "$E = mc^2$".
  it('interpolates LaTeX from material and objective text verbatim', async () => {
    const latexContext = 'From the deck: $$E = mc^2$$ and $& and $` literals.';
    ragService.getLearningObjectiveRagContent.mockResolvedValueOnce(latexContext);
    mockGenerateStructured
      .mockResolvedValueOnce({ content: JSON.stringify(makeMcq('What is ATP?')), usage: {} })
      .mockResolvedValueOnce(makeReviewResponse([cleanRating('0')]));

    const request = buildRequest();
    request.body.learningObjectiveText = 'Explain $$F = ma$$';
    await generateQuestionsWithRagHandler(request, buildResponse());

    const prompt = mockGenerateStructured.mock.calls[0][0].messages[0].content;
    expect(prompt).toContain(latexContext);
    expect(prompt).toContain('Explain $$F = ma$$');
  });
});

describe('generateQuestionsWithRagHandler retrieval settings', () => {
  const ENV_KEYS = [
    'RAG_QUESTION_CHUNK_LIMIT',
    'RAG_CHUNK_LIMIT',
    'RAG_QUESTION_SCORE_THRESHOLD',
    'RAG_SCORE_THRESHOLD',
  ];
  let savedEnv;

  beforeEach(() => {
    savedEnv = {};
    ENV_KEYS.forEach((key) => {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    });
    mockGenerateStructured.mockReset();
    mockGetExistingQuestionTexts.mockResolvedValue([]);
    mockGenerateStructured
      .mockResolvedValueOnce({ content: JSON.stringify(makeMcq('What is ATP?')), usage: {} })
      .mockResolvedValueOnce(makeReviewResponse([cleanRating('0')]));
  });

  afterEach(() => {
    ENV_KEYS.forEach((key) => {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    });
  });

  // getLearningObjectiveRagContent(objectiveId, query, courseId, threshold, limit)
  const retrievalArgs = () => ragService.getLearningObjectiveRagContent.mock.calls[0];

  it('defaults to a 50-chunk budget at threshold 0.6', async () => {
    await generateQuestionsWithRagHandler(buildRequest(), buildResponse());

    expect(retrievalArgs()[3]).toBe(0.6);
    expect(retrievalArgs()[4]).toBe(50);
  });

  // The query is embedded and compared against chunks of course material.
  // Wrapper text ("Get relevant content about...", "for course: Biology")
  // appears in no chunk, so it only pulls the query vector away from the
  // content it is meant to match — which depressed every score enough that the
  // 0.6 threshold filtered everything and the no-threshold fallback became the
  // real retrieval path.
  it('embeds the objective text alone, without wrapper phrasing', async () => {
    await generateQuestionsWithRagHandler(buildRequest(), buildResponse());

    const query = retrievalArgs()[1];
    expect(query).toContain('Explain cellular energy');
    expect(query).toContain('Explain ATP production');
    expect(query).not.toMatch(/get relevant content/i);
    expect(query).not.toMatch(/learning objective:/i);
    expect(query).not.toContain('Biology');
  });

  it('reads the question-specific names', async () => {
    process.env.RAG_QUESTION_CHUNK_LIMIT = '80';
    process.env.RAG_QUESTION_SCORE_THRESHOLD = '0.4';

    await generateQuestionsWithRagHandler(buildRequest(), buildResponse());

    expect(retrievalArgs()[3]).toBe(0.4);
    expect(retrievalArgs()[4]).toBe(80);
  });

  // The pre-rename spellings were dropped outright rather than kept as a
  // fallback, so a deployment still setting them gets the defaults.
  it('ignores the legacy unprefixed names', async () => {
    process.env.RAG_CHUNK_LIMIT = '70';
    process.env.RAG_SCORE_THRESHOLD = '0.5';

    await generateQuestionsWithRagHandler(buildRequest(), buildResponse());

    expect(retrievalArgs()[3]).toBe(0.6);
    expect(retrievalArgs()[4]).toBe(50);
  });
});

// Generation is one conversation per batch: every question after the first sees
// the ones before it, which is the only thing that reliably stops a batch
// converging on one worked example.
//
// The bug that made this worth revisiting is fixed by two things, not by
// abandoning the conversation. Every question type's rules sit in the opening
// message, so a type is never asked for with its rules absent; and each turn
// names the type it wants, so the model is never left inferring it from the
// worked examples of a different type sitting in the history.
describe('generateQuestionsWithRagHandler batch conversation', () => {
  const buildMixedTypeRequest = () => ({
    body: {
      ...buildRequest().body,
      // Understand -> multiple-choice, Remember -> fill-in-the-blank under
      // DEFAULT_BLOOM_TYPE_PREFERENCES, so this batch spans two types.
      bloomLevels: ['Understand', 'Remember'],
      count: 2,
    },
  });

  const makeFitb = (question) => ({
    topicTitle: 'Salt solution acidity',
    question,
    correctAnswer: 'neutral',
    acceptableAnswers: ['neutral', 'pH 7'],
    explanation: 'Strong acid + strong base leaves no hydrolysing ion.',
  });

  const callArgs = (i) => mockGenerateStructured.mock.calls[i][0];
  const opening = (i) => callArgs(i).messages[0].content;
  const turn = (i) => callArgs(i).messages.at(-1).content;

  const queueBatch = () => {
    mockGenerateStructured
      .mockResolvedValueOnce({ content: JSON.stringify(makeMcq('What is ATP?')), usage: {} })
      .mockResolvedValueOnce({
        content: JSON.stringify(makeFitb('A neutral salt gives a solution that is _________.')),
        usage: {},
      })
      .mockResolvedValueOnce(makeReviewResponse([cleanRating('0'), cleanRating('1')]));
  };

  beforeEach(() => {
    mockGenerateStructured.mockReset();
    mockGetExistingQuestionTexts.mockReset();
    mockGetExistingQuestionTexts.mockResolvedValue([]);
  });

  it('issues one request per question, with no planning call', async () => {
    queueBatch();

    await generateQuestionsWithRagHandler(buildMixedTypeRequest(), buildResponse());

    // 2 generations + 1 review.
    expect(mockGenerateStructured).toHaveBeenCalledTimes(3);
  });

  it('carries every type\'s rules in the opening message', async () => {
    queueBatch();

    await generateQuestionsWithRagHandler(buildMixedTypeRequest(), buildResponse());

    // Paid for once at the head of the conversation rather than restated per
    // turn, so no question is ever asked for without its rules present.
    expect(opening(0)).toContain('Generate 4 answer options');
    expect(opening(0)).toContain('Forbidden openings');
    expect(opening(1)).toBe(opening(0));
  });

  it('names the type on every turn so it is never inferred from history', async () => {
    queueBatch();

    await generateQuestionsWithRagHandler(buildMixedTypeRequest(), buildResponse());

    expect(turn(0)).toContain('MULTIPLE-CHOICE');
    expect(turn(1)).toContain('FILL-IN-THE-BLANK');
  });

  it('shows each question the ones already written in this batch', async () => {
    queueBatch();

    await generateQuestionsWithRagHandler(buildMixedTypeRequest(), buildResponse());

    const first = callArgs(0).messages;
    const second = callArgs(1).messages;
    // The first question has only the opening message to work from.
    expect(first).toHaveLength(2);
    // The second sees the first one's turn and its answer.
    expect(second.some((m) => m.role === 'assistant' && m.content.includes('What is ATP?'))).toBe(true);
  });

  // The fix replays the question's own exchange rather than the whole
  // conversation up to it: a sibling's raw JSON in context is a template to
  // copy, and the patch is meant to be targeted at one question.
  // Instructors can replace the generation prompt from Settings. A replacement
  // that drops {typeSpecificInstructions} would otherwise send no type rules at
  // all, while every turn still says "follow the instructions given at the start
  // of this conversation" — pointing at something that was never sent. That is
  // the bug this whole branch started with, reachable again through the prompt
  // editor. The existing-questions block below it already handles the same case.
  it('still sends the type rules when a custom prompt omits the placeholder', async () => {
    const settings = require('../../src/services/settings');
    settings.getSettings.mockResolvedValueOnce({
      prompts: {
        questionGeneration:
          'Course: {courseName}\nObjective: {granularLearningObjectiveText}\nMaterial: {ragContext}',
      },
    });
    queueBatch();

    await generateQuestionsWithRagHandler(buildMixedTypeRequest(), buildResponse());

    expect(opening(0)).toContain('Generate 4 answer options');
    expect(opening(0)).toContain('Forbidden openings');
  });

  it('fixes a flagged question from its own exchange, not the whole batch', async () => {
    mockGenerateStructured
      .mockResolvedValueOnce({ content: JSON.stringify(makeMcq('What is ATP?')), usage: {} })
      .mockResolvedValueOnce({
        content: JSON.stringify(makeFitb('A neutral salt gives a solution that is _________.')),
        usage: {},
      })
      .mockResolvedValueOnce(makeReviewResponse([cleanRating('0'), flaggedRating('1', 'The blank is ambiguous.')]))
      .mockResolvedValueOnce({
        content: JSON.stringify(makeFitb('A strong-acid, strong-base salt is _________.')),
        usage: {},
      })
      .mockResolvedValueOnce(makeReviewResponse([cleanRating('1')]));

    await generateQuestionsWithRagHandler(buildMixedTypeRequest(), buildResponse());

    const fixMessages = callArgs(3).messages;
    expect(fixMessages.some((m) => m.role === 'assistant' && m.content.includes('_________'))).toBe(true);
    expect(fixMessages.some((m) => m.content.includes('What is ATP?'))).toBe(false);
    // ...and with the siblings gone, the turn must not still tell the model to
    // differ from "the questions already written above" — there are none above.
    expect(fixMessages.some((m) => m.content.includes('already written above'))).toBe(false);
  });
});

// A retry is the correction path for anything validateAndNormalize rejects, so
// it has to carry the same rules the first attempt did — plus the specific
// error. Under the conversation this was where a question of a type other than
// the batch's first silently lost its rules entirely.
describe('generateQuestionsWithRagHandler retry turns', () => {
  const buildMixedTypeRequest = () => ({
    body: {
      ...buildRequest().body,
      bloomLevels: ['Understand', 'Remember'],
      count: 2,
    },
  });

  beforeEach(() => {
    mockGenerateStructured.mockReset();
    mockGetExistingQuestionTexts.mockReset();
    mockGetExistingQuestionTexts.mockResolvedValue([]);
  });

  it('carries the type rules and the failure reason into a retry', async () => {
    mockGenerateStructured
      .mockResolvedValueOnce({ content: JSON.stringify(makeMcq('What is ATP?')), usage: {} })
      // The fill-in-the-blank slot returns a multiple-choice stem with a letter
      // for an answer — the exact drift this pipeline produced in the wild.
      // validateAndNormalize rejects it, forcing a retry.
      .mockResolvedValueOnce({
        content: JSON.stringify({
          topicTitle: 'Salt solutions',
          question: 'Which salt solution is expected to be neutral in water?',
          correctAnswer: 'A',
          acceptableAnswers: ['A'],
          explanation: 'Strong acid + strong base.',
        }),
        usage: {},
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          topicTitle: 'Salt solutions',
          question: 'A strong-acid, strong-base salt gives a solution that is _________.',
          correctAnswer: 'neutral',
          acceptableAnswers: ['neutral', 'pH 7'],
          explanation: 'No hydrolysing ion remains.',
        }),
        usage: {},
      })
      .mockResolvedValueOnce(makeReviewResponse([cleanRating('0'), cleanRating('1')]));

    await generateQuestionsWithRagHandler(buildMixedTypeRequest(), buildResponse());

    // 0: question 1. 1: question 2, rejected. 2: question 2, retried.
    const retryMessages = mockGenerateStructured.mock.calls[2][0].messages;
    // The rules are in the opening message, which every turn still carries.
    expect(retryMessages[0].content).toContain('Forbidden openings');
    // The retry restates which type it wants rather than leaving the model to
    // infer it from the rejected attempt.
    expect(retryMessages.at(-1).content).toContain('FILL-IN-THE-BLANK');
    // The rejected attempt and the reason it was rejected are both in front of
    // the model on the retry.
    expect(retryMessages.some((m) => m.content.includes('Which salt solution'))).toBe(true);
    expect(retryMessages.at(-1).content).toContain('exactly one blank');
  });
});
