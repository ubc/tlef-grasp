jest.mock('../../src/services/database', () => ({
  connect: jest.fn(),
}));

const databaseService = require('../../src/services/database');
const quizService = require('../../src/services/quiz');

describe('quiz service settings', () => {
  let collection;

  beforeEach(() => {
    collection = {
      insertOne: jest.fn().mockResolvedValue({ insertedId: 'quiz-1' }),
      updateOne: jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    };
    databaseService.connect.mockResolvedValue({
      collection: jest.fn(() => collection),
    });
  });

  it('defaults previous navigation to enabled for new quizzes', async () => {
    await quizService.createQuiz('course-1', {
      name: 'Practice Quiz',
      deliveryFormat: 'all-approved',
    });

    expect(collection.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        disablePreviousNavigation: false,
      })
    );
  });

  it('stores disabled previous navigation when requested', async () => {
    await quizService.createQuiz('course-1', {
      name: 'Practice Quiz',
      deliveryFormat: 'all-approved',
      disablePreviousNavigation: true,
    });

    expect(collection.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        disablePreviousNavigation: true,
      })
    );
  });

  it('keeps explicit boolean updates while removing undefined fields', async () => {
    await quizService.updateQuiz('quiz-1', {
      name: undefined,
      disablePreviousNavigation: false,
    });

    const update = collection.updateOne.mock.calls[0][1].$set;
    expect(update).toEqual(
      expect.objectContaining({
        disablePreviousNavigation: false,
        updatedAt: expect.any(Date),
      })
    );
    expect(update).not.toHaveProperty('name');
  });
});
