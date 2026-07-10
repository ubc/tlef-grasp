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
        timeLimitMinutes: 60,
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

  it('stores a configured time limit', async () => {
    await quizService.createQuiz('course-1', {
      name: 'Timed Quiz',
      deliveryFormat: 'all-approved',
      timeLimitMinutes: 90,
    });

    expect(collection.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ timeLimitMinutes: 90 })
    );
  });
});

describe('gradeAttempt', () => {
  let attemptCollection;
  let scoreCollection;

  beforeEach(() => {
    attemptCollection = {
      findOne: jest.fn(),
      find: jest.fn(),
      updateOne: jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    };
    scoreCollection = {
      updateOne: jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    };
    databaseService.connect.mockResolvedValue({
      collection: jest.fn((name) => {
        if (name === 'grasp_student_attempt') return attemptCollection;
        if (name === 'grasp_quiz_score') return scoreCollection;
        throw new Error(`Unexpected collection: ${name}`);
      }),
    });
  });

  it('allows an instructor to override an AI-graded fill-in-the-blank attempt', async () => {
    const attempt = {
      _id: 'attempt-1',
      userId: 'student-1',
      quizId: 'quiz-1',
      questionId: 'fib-question-1',
      questionType: 'fill-in-the-blank',
      isCorrect: true,
      aiGraded: true,
      isFirstAttempt: false,
    };
    attemptCollection.findOne.mockResolvedValue(attempt);
    attemptCollection.find.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([{ ...attempt, isCorrect: false }]),
    });

    await expect(
      quizService.gradeAttempt('student-1', 'quiz-1', 'fib-question-1', false)
    ).resolves.toEqual({ score: 0, correctAnswers: 0, totalQuestions: 1 });

    expect(attemptCollection.findOne).toHaveBeenCalledWith({
      userId: 'student-1',
      quizId: 'quiz-1',
      questionId: 'fib-question-1',
      questionType: { $in: ['open-ended', 'fill-in-the-blank'] },
      isFirstAttempt: { $ne: false },
    }, { sort: { createdAt: -1 } });
    expect(attemptCollection.updateOne).toHaveBeenCalledWith(
      { _id: 'attempt-1' },
      { $set: { isCorrect: false, gradedAt: expect.any(Date) } }
    );
    expect(scoreCollection.updateOne).toHaveBeenCalledWith(
      { userId: 'student-1', quizId: 'quiz-1' },
      { $set: { score: 0, correctAnswers: 0, totalQuestions: 1 } }
    );
  });

  it('does not allow overriding an exact-match fill-in-the-blank attempt', async () => {
    attemptCollection.findOne.mockResolvedValue({
      _id: 'attempt-1',
      questionType: 'fill-in-the-blank',
      isCorrect: true,
      aiGraded: false,
    });

    await expect(
      quizService.gradeAttempt('student-1', 'quiz-1', 'fib-question-1', false)
    ).rejects.toThrow('Attempt has already been graded');

    expect(attemptCollection.updateOne).not.toHaveBeenCalled();
    expect(scoreCollection.updateOne).not.toHaveBeenCalled();
  });
});
