import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const mockPost = jest.fn();
jest.unstable_mockModule('../../client/src/lib/api.js', () => ({ api: { post: mockPost } }));

const { generateQuestions } = await import('../../client/src/pages/question-generation/generationApi.js');

const objectiveGroups = [
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

const course = { id: 'course-1', name: 'Biology' };
const okResponse = (text) => ({
  success: true,
  questions: [{ question: text, questionType: 'multiple-choice', options: {}, correctAnswer: 'A' }],
  tokenUsage: {},
});

describe('tail retry sweep', () => {
  beforeEach(() => mockPost.mockReset());

  it('retries a rate-limited objective once and recovers it', async () => {
    let g2Attempts = 0;
    mockPost.mockImplementation(async (_url, body) => {
      if (body.granularLearningObjectiveId === 'g-2') {
        g2Attempts += 1;
        if (g2Attempts === 1) throw Object.assign(new Error('slow down'), { status: 429 });
        return okResponse('from g-2 on retry');
      }
      return okResponse('from g-1');
    });

    const { questions, failures } = await generateQuestions(course, objectiveGroups, undefined, { concurrency: 2 });

    expect(g2Attempts).toBe(2);
    expect(failures).toHaveLength(0);
    expect(questions.map((q) => q.text)).toEqual(['from g-1', 'from g-2 on retry']);
  });

  it('does not retry a non-retryable failure, but still sweeps a retryable one alongside it', async () => {
    // g-2 fails for a non-retryable reason (no status/rateLimited flag) and
    // must never be re-requested. g-3 fails for a retryable (429) reason and
    // must recover on the sweep. Combining them in one run means this test
    // only passes when the implementation actually filters the sweep by
    // `rateLimited` — a sweep with no filter (retries everything) or no
    // sweep at all (today's behaviour) both produce a different, wrong
    // outcome here.
    const twoObjectiveGroups = [
      {
        objectiveId: 'lo-1',
        title: 'Explain cellular energy',
        materialIds: [],
        items: [
          { granularId: 'g-1', text: 'Explain ATP', bloom: ['Understand'], count: 1 },
          { granularId: 'g-2', text: 'Explain glycolysis', bloom: ['Understand'], count: 1 },
          { granularId: 'g-3', text: 'Explain Krebs cycle', bloom: ['Understand'], count: 1 },
        ],
      },
    ];

    let g2Attempts = 0;
    let g3Attempts = 0;
    mockPost.mockImplementation(async (_url, body) => {
      const id = body.granularLearningObjectiveId;
      if (id === 'g-2') {
        g2Attempts += 1;
        throw new Error('objective has no material');
      }
      if (id === 'g-3') {
        g3Attempts += 1;
        if (g3Attempts === 1) throw Object.assign(new Error('slow down'), { status: 429 });
        return okResponse('from g-3 on retry');
      }
      return okResponse('from g-1');
    });

    const { questions, failures } = await generateQuestions(
      course,
      twoObjectiveGroups,
      undefined,
      { concurrency: 3 }
    );

    expect(g2Attempts).toBe(1);
    expect(g3Attempts).toBe(2);
    expect(failures).toHaveLength(1);
    expect(failures[0].granularId).toBe('g-2');
    expect(questions.map((q) => q.text)).toEqual(['from g-1', 'from g-3 on retry']);
  });

  it('keeps a recovered objective in objective order, not appended at the end', async () => {
    // Three objectives, concurrency 1 so completion order is launch order.
    // g-2 (the middle objective) fails once for a rate-limited reason, then
    // succeeds on the sweep. If the sweep just appended recovered results,
    // the final order would be [g-1, g-3, g-2]; the fix must re-sort by the
    // unit's original position so it lands back in the middle.
    const threeGroups = [
      {
        objectiveId: 'lo-1',
        title: 'Explain cellular energy',
        materialIds: [],
        items: [
          { granularId: 'g-1', text: 'Explain ATP', bloom: ['Understand'], count: 1 },
          { granularId: 'g-2', text: 'Explain glycolysis', bloom: ['Understand'], count: 1 },
          { granularId: 'g-3', text: 'Explain Krebs cycle', bloom: ['Understand'], count: 1 },
        ],
      },
    ];

    let g2Attempts = 0;
    mockPost.mockImplementation(async (_url, body) => {
      const id = body.granularLearningObjectiveId;
      if (id === 'g-2') {
        g2Attempts += 1;
        if (g2Attempts === 1) throw Object.assign(new Error('slow down'), { status: 429 });
        return okResponse('from g-2 on retry');
      }
      return okResponse(`from ${id}`);
    });

    const { questions, failures } = await generateQuestions(course, threeGroups, undefined, { concurrency: 1 });

    expect(failures).toHaveLength(0);
    expect(questions.map((q) => q.text)).toEqual(['from g-1', 'from g-2 on retry', 'from g-3']);
  });

  it('resolves with a partial-failure report instead of throwing when other objectives legitimately return zero questions', async () => {
    // Two objectives succeed but genuinely have nothing to return (an empty
    // questions array is a valid response, not a failure); one objective
    // fails outright. allQuestions.length ends up 0, but only one of three
    // objectives actually failed — this must not read as a total outage.
    const threeGroups = [
      {
        objectiveId: 'lo-1',
        title: 'Explain cellular energy',
        materialIds: [],
        items: [
          { granularId: 'g-1', text: 'Explain ATP', bloom: ['Understand'], count: 1 },
          { granularId: 'g-2', text: 'Explain glycolysis', bloom: ['Understand'], count: 1 },
          { granularId: 'g-3', text: 'Explain Krebs cycle', bloom: ['Understand'], count: 1 },
        ],
      },
    ];

    mockPost.mockImplementation(async (_url, body) => {
      const id = body.granularLearningObjectiveId;
      if (id === 'g-3') throw new Error('objective has no material');
      return { success: true, questions: [], tokenUsage: {} };
    });

    const { questions, failures } = await generateQuestions(course, threeGroups, undefined, { concurrency: 3 });

    expect(questions).toHaveLength(0);
    expect(failures).toHaveLength(1);
    expect(failures[0].granularId).toBe('g-3');
  });

  it('recovers breaker-tripped-but-launched objectives on the sweep while never re-requesting the ones the breaker skipped', async () => {
    // g-1 succeeds (resets the streak); g-2..g-6 429 on their first attempt
    // (tripping the circuit breaker on the 5th consecutive rate limit) but
    // succeed on a second attempt, so the sweep should recover all 5; g-7
    // never launches at all — the breaker skipped it — and is reported via
    // PoolAbortedError.
    //
    // g-2..g-6 recovering is what makes this fail against code with no sweep
    // (they would stay failed, and the pool's own abort would even count
    // g-7 as rate-limited — see the sibling test in generation-api-pool for
    // that regression). g-7 never being called is what would catch a sweep
    // that retries indiscriminately instead of filtering by `rateLimited`.
    const sevenGroups = [
      {
        objectiveId: 'lo-1',
        title: 'Explain cellular energy',
        materialIds: [],
        items: [
          { granularId: 'g-1', text: 'Obj 1', bloom: ['Understand'], count: 1 },
          { granularId: 'g-2', text: 'Obj 2', bloom: ['Understand'], count: 1 },
          { granularId: 'g-3', text: 'Obj 3', bloom: ['Understand'], count: 1 },
          { granularId: 'g-4', text: 'Obj 4', bloom: ['Understand'], count: 1 },
          { granularId: 'g-5', text: 'Obj 5', bloom: ['Understand'], count: 1 },
          { granularId: 'g-6', text: 'Obj 6', bloom: ['Understand'], count: 1 },
          { granularId: 'g-7', text: 'Obj 7', bloom: ['Understand'], count: 1 },
        ],
      },
    ];

    const rateLimitedIds = new Set(['g-2', 'g-3', 'g-4', 'g-5', 'g-6']);
    const callCounts = {};
    mockPost.mockImplementation(async (_url, body) => {
      const id = body.granularLearningObjectiveId;
      callCounts[id] = (callCounts[id] || 0) + 1;
      if (rateLimitedIds.has(id) && callCounts[id] === 1) {
        throw Object.assign(new Error('slow down'), { status: 429 });
      }
      return okResponse(`from ${id}`);
    });

    const { questions, failures } = await generateQuestions(course, sevenGroups, undefined, { concurrency: 1 });

    // g-7 was never launched by the initial pool, and must not be launched
    // by the sweep either.
    expect(callCounts['g-7']).toBeUndefined();
    for (const id of rateLimitedIds) {
      expect(callCounts[id]).toBe(2);
    }

    expect(failures).toHaveLength(1);
    expect(failures[0].granularId).toBe('g-7');
    expect(failures[0].rateLimited).toBe(false);
    expect(failures[0].reason).toContain('stopped early');

    expect(questions.map((q) => q.text)).toEqual([
      'from g-1',
      'from g-2',
      'from g-3',
      'from g-4',
      'from g-5',
      'from g-6',
    ]);
  });
});
