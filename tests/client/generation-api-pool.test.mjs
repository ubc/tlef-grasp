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
    mockPost.mockRejectedValueOnce(Object.assign(new Error('slow down'), { status: 429 }));
    mockPost.mockResolvedValue(okResponse('from g-2'));

    const { failures } = await generateQuestions(course, objectiveGroups, undefined, { concurrency: 1 });

    expect(failures[0].rateLimited).toBe(true);
  });
});
