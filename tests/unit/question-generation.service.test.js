const { ObjectId } = require('mongodb');

jest.mock('../../src/services/database', () => ({
  connect: jest.fn(),
}));

const databaseService = require('../../src/services/database');
const questionService = require('../../src/services/question');

describe('question generation exclusions', () => {
  it('loads active question text only from the requested course and granular objective', async () => {
    const courseId = new ObjectId();
    const granularObjectiveId = new ObjectId();
    const toArray = jest.fn().mockResolvedValue([
      { questionType: 'multiple-choice', title: 'Existing MCQ', stem: 'Select one' },
      { questionType: 'open-ended', title: 'Topic', stem: 'Explain the pathway' },
      { question: 'Legacy generated question' },
    ]);
    const find = jest.fn(() => ({ toArray }));
    databaseService.connect.mockResolvedValue({
      collection: jest.fn(() => ({ find })),
    });

    await expect(
      questionService.getQuestionTextsByGranularObjective(
        courseId.toString(),
        granularObjectiveId.toString()
      )
    ).resolves.toEqual([
      'Existing MCQ',
      'Explain the pathway',
      'Legacy generated question',
    ]);

    expect(find).toHaveBeenCalledWith(
      {
        courseId,
        granularObjectiveId,
        orphaned: { $ne: true },
      },
      expect.objectContaining({ projection: expect.any(Object) })
    );
  });

  it('does not query when an objective identifier is missing', async () => {
    await expect(
      questionService.getQuestionTextsByGranularObjective('course-1', null)
    ).resolves.toEqual([]);
    expect(databaseService.connect).not.toHaveBeenCalled();
  });
});
