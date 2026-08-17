import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const mockPost = jest.fn();
jest.unstable_mockModule('../../client/src/lib/api.js', () => ({
  api: { post: mockPost },
}));

const { generateQuestions } = await import('../../client/src/pages/question-generation/generationApi.js');

const objectiveGroups = [
  {
    objectiveId: 'lo-1',
    title: 'Explain cellular energy',
    materialIds: ['m-1'],
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
  tokenUsage: { generation: { promptTokens: 1, completionTokens: 1 } },
});

describe('generateQuestions concurrency', () => {
  beforeEach(() => mockPost.mockReset());

  it('issues objective requests concurrently', async () => {
    let inFlight = 0;
    let peak = 0;
    mockPost.mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight -= 1;
      return okResponse('Q');
    });

    await generateQuestions(course, objectiveGroups, undefined, { concurrency: 2 });

    expect(peak).toBe(2);
  });

  it('keeps questions in objective order when the first request is slowest', async () => {
    mockPost.mockImplementation(async (_url, body) => {
      if (body.granularLearningObjectiveId === 'g-1') {
        await new Promise((r) => setTimeout(r, 20));
        return okResponse('from g-1');
      }
      return okResponse('from g-2');
    });

    const { questions } = await generateQuestions(course, objectiveGroups, undefined, { concurrency: 2 });

    expect(questions.map((q) => q.text)).toEqual(['from g-1', 'from g-2']);
  });

  it('reports a failed objective instead of dropping it', async () => {
    mockPost.mockImplementation(async (_url, body) => {
      if (body.granularLearningObjectiveId === 'g-2') throw new Error('boom');
      return okResponse('from g-1');
    });

    const { questions, failures } = await generateQuestions(course, objectiveGroups, undefined, { concurrency: 2 });

    expect(questions).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0].granularId).toBe('g-2');
    expect(failures[0].reason).toContain('boom');
  });

  it('throws only when every objective fails', async () => {
    mockPost.mockRejectedValue(new Error('everything is down'));

    await expect(
      generateQuestions(course, objectiveGroups, undefined, { concurrency: 2 })
    ).rejects.toThrow('everything is down');
  });

  it('marks a 429 failure as rate limited', async () => {
    // g-1 429s on every attempt (including the tail retry sweep, which would
    // otherwise recover a transient failure and leave nothing to inspect
    // here), so the persisting failure can be checked for the flag.
    mockPost.mockImplementation(async (_url, body) => {
      if (body.granularLearningObjectiveId === 'g-1') {
        throw Object.assign(new Error('slow down'), { status: 429 });
      }
      return okResponse('from g-2');
    });

    const { failures } = await generateQuestions(course, objectiveGroups, undefined, { concurrency: 1 });

    expect(failures[0].rateLimited).toBe(true);
  });
});

// Eleven granular objectives, only used by the circuit-breaker tests below.
// Eleven (not nine) matters for the "scattered" test: the 5th rate limit
// there lands on objective 9, so two more objectives (10, 11) must still run
// afterwards for that test to prove anything — with only 9 objectives the
// cumulative-vs-consecutive bug is invisible because there'd be nothing left
// to wrongly abort once the 5th (and last) failure fires.
const elevenObjectiveGroups = [
  {
    objectiveId: 'lo-2',
    title: 'Rate limit sweep',
    materialIds: ['m-2'],
    items: Array.from({ length: 11 }, (_, i) => ({
      granularId: `r-${i + 1}`,
      text: `Objective ${i + 1}`,
      bloom: ['Understand'],
      count: 1,
    })),
  },
];

const rateLimitedError = () => Object.assign(new Error('slow down'), { status: 429 });

describe('generateQuestions rate-limit circuit breaker', () => {
  beforeEach(() => mockPost.mockReset());

  it('does not trip on 5 scattered rate limits that are never consecutive', async () => {
    // Objectives 1, 3, 5, 7, 9 429; every other objective (including the
    // trailing 10 and 11) succeeds. Every failure is immediately followed by
    // a success, so the streak never reaches the breaker's threshold of
    // 5-in-a-row — but a *cumulative* (rather than consecutive) counter would
    // wrongly hit 5 at objective 9 and abort objectives 10 and 11.
    const rateLimited = new Set([1, 3, 5, 7, 9]);
    mockPost.mockImplementation(async (_url, body) => {
      const n = Number(body.granularLearningObjectiveId.split('-')[1]);
      if (rateLimited.has(n)) throw rateLimitedError();
      return okResponse(`from r-${n}`);
    });

    const { questions, failures } = await generateQuestions(
      course,
      elevenObjectiveGroups,
      undefined,
      { concurrency: 1 }
    );

    // All 11 objectives were launched — the breaker never fired, including
    // for objectives 10 and 11, which only run if the counter was reset by
    // the successes at 2, 4, 6, and 8. The 5 that 429 are genuinely
    // rate-limited (not breaker-skipped), so Task 7's tail sweep retries all
    // 5 of them once more (still 429, per this mock), for 11 + 5 = 16 calls.
    expect(mockPost).toHaveBeenCalledTimes(16);
    expect(questions).toHaveLength(6);
    expect(failures).toHaveLength(5);
    expect(failures.every((f) => f.rateLimited)).toBe(true);
    // None of the failures should be the pool's own abort — that would mean
    // the breaker mistakenly fired on scattered (non-consecutive) failures.
    expect(failures.every((f) => !f.reason.includes('stopped early'))).toBe(true);
  });

  it('trips after 5 consecutive rate limits and stops launching further objectives', async () => {
    // The first 5 objectives 429 back-to-back; the remaining 6 would succeed
    // if reached, so only the breaker tripping can explain them never running.
    mockPost.mockImplementation(async (_url, body) => {
      const n = Number(body.granularLearningObjectiveId.split('-')[1]);
      if (n <= 5) throw rateLimitedError();
      return okResponse(`from r-${n}`);
    });

    await expect(
      generateQuestions(course, elevenObjectiveGroups, undefined, { concurrency: 1 })
    ).rejects.toThrow('slow down');

    // r-6..r-11 were never launched by the initial pool, and the tail sweep
    // only retries genuinely rate-limited failures — never objectives the
    // breaker skipped — so they must still never appear in the call log.
    const launchedIds = new Set(
      mockPost.mock.calls.map(([, body]) => body.granularLearningObjectiveId)
    );
    for (let n = 6; n <= 11; n += 1) {
      expect(launchedIds.has(`r-${n}`)).toBe(false);
    }

    // The 5 consecutive failures were attempted once by the initial pool,
    // then once more by Task 7's tail sweep (still 429, per this mock): 10.
    expect(mockPost).toHaveBeenCalledTimes(10);
  });
});
