// Finding 3 (final branch review): spec section 5 requires the run to stop
// immediately on 401/403, not just after 5 consecutive rate limits. Before
// this fix, a revoked session or lost course access fired every remaining
// objective and failed all of them, one request at a time, instead of
// aborting on the first one.
import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const mockPost = jest.fn();
jest.unstable_mockModule('../../client/src/lib/api.js', () => ({
  api: { post: mockPost },
}));

const { generateQuestions } = await import('../../client/src/pages/question-generation/generationApi.js');

const course = { id: 'course-1', name: 'Biology' };
const okResponse = (text) => ({
  success: true,
  questions: [{ question: text, questionType: 'multiple-choice', options: {}, correctAnswer: 'A' }],
  tokenUsage: {},
});

// Eleven objectives: the first fails fatally, the rest would succeed if
// reached — so anything launched past the first proves the breaker didn't
// trip immediately.
const elevenObjectiveGroups = [
  {
    objectiveId: 'lo-1',
    title: 'Auth check',
    materialIds: [],
    items: Array.from({ length: 11 }, (_, i) => ({
      granularId: `r-${i + 1}`,
      text: `Objective ${i + 1}`,
      bloom: ['Understand'],
      count: 1,
    })),
  },
];

describe.each([401, 403])('generateQuestions fatal circuit break on %i', (status) => {
  beforeEach(() => mockPost.mockReset());

  it('stops launching further objectives immediately, without waiting for 5 consecutive rate limits', async () => {
    mockPost.mockImplementation(async (_url, body) => {
      const n = Number(body.granularLearningObjectiveId.split('-')[1]);
      if (n === 1) {
        throw Object.assign(new Error(`denied with ${status}`), { status });
      }
      return okResponse(`from r-${n}`);
    });

    await expect(
      generateQuestions(course, elevenObjectiveGroups, undefined, { concurrency: 1 })
    ).rejects.toThrow(`denied with ${status}`);

    // Only the first objective was ever sent — concurrency 1 means the pool
    // must have aborted before launching a second task.
    expect(mockPost).toHaveBeenCalledTimes(1);
    const launchedIds = new Set(mockPost.mock.calls.map(([, body]) => body.granularLearningObjectiveId));
    for (let n = 2; n <= 11; n += 1) {
      expect(launchedIds.has(`r-${n}`)).toBe(false);
    }
  });

});

describe('generateQuestions: fatal path does not disturb the rate-limit path', () => {
  beforeEach(() => mockPost.mockReset());

  it('still marks a 429 as rateLimited rather than fatal', async () => {
    mockPost.mockImplementation(async (_url, body) => {
      if (body.granularLearningObjectiveId === 'g-1') {
        throw Object.assign(new Error('slow down'), { status: 429 });
      }
      return okResponse('from g-2');
    });

    const twoObjectiveGroups = [
      {
        objectiveId: 'lo-1',
        title: 'Explain cellular energy',
        materialIds: [],
        items: [
          { granularId: 'g-1', text: 'Explain ATP', bloom: ['Understand'], count: 1 },
          { granularId: 'g-2', text: 'Explain glycolysis', bloom: ['Understand'], count: 1 },
        ],
      },
    ];

    const { failures } = await generateQuestions(course, twoObjectiveGroups, undefined, { concurrency: 1 });

    expect(failures.some((f) => f.granularId === 'g-1' && f.rateLimited)).toBe(true);
  });
});
