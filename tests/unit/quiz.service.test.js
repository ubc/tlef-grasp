jest.mock('../../src/services/database', () => ({
  connect: jest.fn(),
}));

const databaseService = require('../../src/services/database');
const quizService = require('../../src/services/quiz');
const { ObjectId } = require('mongodb');

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

describe('addExistingQuestionsToQuiz', () => {
  it('adds only live, same-course questions with a valid granular objective and skips duplicates', async () => {
    const courseId = new ObjectId();
    const quizId = new ObjectId();
    const newQuestionId = new ObjectId();
    const existingQuestionId = new ObjectId();
    const invalidQuestionId = new ObjectId();
    const granularId = new ObjectId();

    const questionCursor = {
      project: jest.fn(),
      toArray: jest.fn().mockResolvedValue([
        { _id: newQuestionId, granularObjectiveId: granularId },
        { _id: existingQuestionId, granularObjectiveId: granularId },
      ]),
    };
    questionCursor.project.mockReturnValue(questionCursor);
    const objectiveCursor = {
      project: jest.fn(),
      toArray: jest.fn().mockResolvedValue([{ _id: granularId }]),
    };
    objectiveCursor.project.mockReturnValue(objectiveCursor);
    const mappingCursor = {
      project: jest.fn(),
      toArray: jest.fn().mockResolvedValue([{ questionId: existingQuestionId }]),
    };
    mappingCursor.project.mockReturnValue(mappingCursor);
    const questionCollection = {
      find: jest.fn().mockReturnValue(questionCursor),
    };
    const objectiveCollection = {
      find: jest.fn().mockReturnValue(objectiveCursor),
    };
    const quizQuestionCollection = {
      find: jest.fn().mockReturnValue(mappingCursor),
      insertMany: jest.fn().mockResolvedValue({ insertedCount: 1 }),
    };
    databaseService.connect.mockResolvedValue({
      collection: jest.fn((name) => {
        if (name === 'grasp_question') return questionCollection;
        if (name === 'grasp_objective') return objectiveCollection;
        if (name === 'grasp_quiz_question') return quizQuestionCollection;
        throw new Error(`Unexpected collection: ${name}`);
      }),
    });

    await expect(
      quizService.addExistingQuestionsToQuiz(
        quizId.toString(),
        courseId.toString(),
        [newQuestionId.toString(), existingQuestionId.toString(), invalidQuestionId.toString()]
      )
    ).resolves.toEqual({ insertedCount: 1, skippedCount: 2 });

    expect(questionCollection.find).toHaveBeenCalledWith(
      expect.objectContaining({
        courseId,
        orphaned: { $ne: true },
      })
    );
    expect(objectiveCollection.find).toHaveBeenCalledWith(
      expect.objectContaining({
        courseId,
        parent: { $ne: 0 },
      })
    );
    expect(quizQuestionCollection.insertMany).toHaveBeenCalledWith([
      expect.objectContaining({ quizId, questionId: newQuestionId, createdAt: expect.any(Date) }),
    ]);
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
      findOne: jest.fn().mockResolvedValue(null),
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

  // Issue #65: the score denominator is the number of questions served at
  // submit time, not the number answered. A regrade recalculation must keep
  // the stored totalQuestions instead of shrinking it to the attempt count.
  it('keeps the stored totalQuestions when regrading a partially answered quiz', async () => {
    const attempt = {
      _id: 'attempt-1',
      userId: 'student-1',
      quizId: 'quiz-1',
      questionId: 'oe-question-1',
      questionType: 'open-ended',
      isCorrect: null,
      aiGraded: true,
      isFirstAttempt: false,
    };
    attemptCollection.findOne.mockResolvedValue(attempt);
    attemptCollection.find.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([{ ...attempt, isCorrect: true }]),
    });
    scoreCollection.findOne.mockResolvedValue({
      userId: 'student-1',
      quizId: 'quiz-1',
      totalQuestions: 10,
    });

    await expect(
      quizService.gradeAttempt('student-1', 'quiz-1', 'oe-question-1', true)
    ).resolves.toEqual({ score: 10, correctAnswers: 1, totalQuestions: 10 });

    expect(scoreCollection.updateOne).toHaveBeenCalledWith(
      { userId: 'student-1', quizId: 'quiz-1' },
      { $set: { score: 10, correctAnswers: 1, totalQuestions: 10 } }
    );
  });

  it('finishes an idempotent retry after a manual grade was only partially saved', async () => {
    const attempt = {
      _id: 'attempt-1',
      userId: 'student-1',
      courseId: 'course-1',
      quizId: 'quiz-1',
      questionId: 'oe-question-1',
      questionType: 'open-ended',
      granularObjectiveId: 'granular-3',
      learningObjectiveId: null,
      bloom: 'Understand',
      isCorrect: true,
      aiGraded: true,
      gradedAt: new Date('2026-07-13T12:00:00Z'),
      isFirstAttempt: true,
    };
    const performanceCollection = {
      findOne: jest.fn().mockResolvedValue(null),
      updateOne: jest.fn().mockResolvedValue({ upsertedCount: 1 }),
    };
    attemptCollection.findOne.mockResolvedValue(attempt);
    attemptCollection.find.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([attempt]),
    });
    databaseService.connect.mockResolvedValue({
      collection: jest.fn((name) => {
        if (name === 'grasp_student_attempt') return attemptCollection;
        if (name === 'grasp_student_performance') return performanceCollection;
        if (name === 'grasp_quiz_score') return scoreCollection;
        throw new Error(`Unexpected collection: ${name}`);
      }),
    });

    await expect(
      quizService.gradeAttempt('student-1', 'quiz-1', 'oe-question-1', true)
    ).resolves.toEqual({ score: 100, correctAnswers: 1, totalQuestions: 1 });

    // The attempt was already finalized before the original E11000, so the
    // retry repairs the missing mastery/score without rewriting the attempt.
    expect(attemptCollection.updateOne).not.toHaveBeenCalled();
    expect(performanceCollection.updateOne).toHaveBeenCalledWith(
      {
        userId: 'student-1',
        courseId: 'course-1',
        learningObjectiveId: null,
        granularObjectiveId: 'granular-3',
      },
      expect.objectContaining({
        $set: expect.objectContaining({ needsRemediation: false }),
        $inc: { timesCorrect: 1 },
      }),
      { upsert: true }
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
