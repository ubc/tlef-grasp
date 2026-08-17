// The client pool decides whether to pause and shrink concurrency based on
// this status. Flattening a 429 into a 500 makes "slow down" look like "broken".
const express = require('express');
const request = require('supertest');

const mockGenerateStructured = jest.fn();

jest.mock('../../src/services/rag', () => ({
  getLearningObjectiveRagContent: jest.fn().mockResolvedValue('Relevant material'),
}));
jest.mock('../../src/services/llm', () => ({ isReady: jest.fn(() => true) }));
jest.mock('../../src/services/question', () => ({
  getQuestionTextsByGranularObjective: jest.fn().mockResolvedValue([]),
}));
jest.mock('../../src/services/settings', () => ({ getSettings: jest.fn().mockResolvedValue(null) }));
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
jest.mock('../../src/utils/structured-llm', () => ({ generateStructured: mockGenerateStructured }));
// Without this, generateStructured's rejection is retried inside the real
// generationLimiter (3 retries with exponential backoff) before reaching the
// handler, which distorts call counts/timing and can push the test past its
// timeout. The handler under test is what maps the error to a status code,
// not the limiter, so the limiter is stubbed to a pass-through here exactly
// as tests/unit/generation-limiter-wiring.test.js does.
jest.mock('../../src/utils/generation-limiter', () => ({
  generationLimiter: { run: jest.fn((fn) => fn()) },
}));

const { generateQuestionsWithRagHandler } = require('../../src/controllers/rag-llm');

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.post('/generate', generateQuestionsWithRagHandler);
  return app;
};

const body = {
  courseId: 'course-1',
  courseName: 'Biology',
  learningObjectiveId: 'objective-1',
  learningObjectiveText: 'Explain cellular energy',
  granularLearningObjectiveId: 'granular-1',
  granularLearningObjectiveText: 'Explain ATP production',
  bloomLevels: ['Understand'],
  count: 1,
};

describe('generation rate-limit status', () => {
  beforeEach(() => mockGenerateStructured.mockReset());

  it('answers 429 with Retry-After when the provider rate limits', async () => {
    const error = new Error('429 Rate limit reached');
    error.status = 429;
    mockGenerateStructured.mockRejectedValue(error);

    const response = await request(buildApp()).post('/generate').send(body).expect(429);

    expect(response.headers['retry-after']).toBeDefined();
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
    expect(response.body.rateLimited).toBe(true);
  });

  it('still answers 500 for an ordinary failure', async () => {
    mockGenerateStructured.mockRejectedValue(new Error('schema exploded'));

    const response = await request(buildApp()).post('/generate').send(body).expect(500);
    expect(response.body.rateLimited).toBeUndefined();
  });
});
