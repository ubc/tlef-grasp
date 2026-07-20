jest.mock('../../src/services/database', () => ({
  connect: jest.fn(),
}));

const databaseService = require('../../src/services/database');
const quizService = require('../../src/services/quiz');

// Student accept/deny of an AI grade (issue #76). The service only touches a
// `studentGradeReview` marker on the attempt — it never changes the grade — and
// is restricted to AI-graded, not-yet-finalized attempts.
describe('recordStudentGradeReview', () => {
  let attemptCollection;

  const aiAttempt = {
    _id: 'attempt-1',
    userId: 'student-1',
    quizId: 'quiz-1',
    questionId: 'oe-question-1',
    questionType: 'open-ended',
    isCorrect: true,
    aiGraded: true,
    isFirstAttempt: true,
  };

  beforeEach(() => {
    attemptCollection = {
      findOne: jest.fn(),
      updateOne: jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    };
    databaseService.connect.mockResolvedValue({
      collection: jest.fn((name) => {
        if (name === 'grasp_student_attempt') return attemptCollection;
        throw new Error(`Unexpected collection: ${name}`);
      }),
    });
  });

  it('records a denial on an AI-graded, un-finalized attempt', async () => {
    attemptCollection.findOne.mockResolvedValue({ ...aiAttempt });

    await expect(
      quizService.recordStudentGradeReview('student-1', 'quiz-1', 'oe-question-1', 'deny')
    ).resolves.toEqual({ studentGradeReview: 'deny' });

    expect(attemptCollection.findOne).toHaveBeenCalledWith({
      userId: 'student-1',
      quizId: 'quiz-1',
      questionId: 'oe-question-1',
      isFirstAttempt: { $ne: false },
    });
    expect(attemptCollection.updateOne).toHaveBeenCalledWith(
      { _id: 'attempt-1' },
      { $set: { studentGradeReview: 'deny', studentGradeReviewAt: expect.any(Date) } }
    );
  });

  it('records an acceptance (the default choice) the same way', async () => {
    attemptCollection.findOne.mockResolvedValue({ ...aiAttempt, studentGradeReview: 'deny' });

    await expect(
      quizService.recordStudentGradeReview('student-1', 'quiz-1', 'oe-question-1', 'accept')
    ).resolves.toEqual({ studentGradeReview: 'accept' });

    expect(attemptCollection.updateOne).toHaveBeenCalledWith(
      { _id: 'attempt-1' },
      { $set: { studentGradeReview: 'accept', studentGradeReviewAt: expect.any(Date) } }
    );
  });

  it('rejects an invalid review value before touching the database', async () => {
    await expect(
      quizService.recordStudentGradeReview('student-1', 'quiz-1', 'oe-question-1', 'maybe')
    ).rejects.toThrow('Invalid grade review');

    expect(databaseService.connect).not.toHaveBeenCalled();
  });

  it('throws when the attempt does not exist', async () => {
    attemptCollection.findOne.mockResolvedValue(null);

    await expect(
      quizService.recordStudentGradeReview('student-1', 'quiz-1', 'missing', 'deny')
    ).rejects.toThrow('Attempt not found');

    expect(attemptCollection.updateOne).not.toHaveBeenCalled();
  });

  it('refuses a non-AI-graded attempt (nothing to react to)', async () => {
    attemptCollection.findOne.mockResolvedValue({
      ...aiAttempt,
      questionType: 'fill-in-the-blank',
      aiGraded: false,
    });

    await expect(
      quizService.recordStudentGradeReview('student-1', 'quiz-1', 'fib-1', 'deny')
    ).rejects.toThrow('Attempt is not AI-graded');

    expect(attemptCollection.updateOne).not.toHaveBeenCalled();
  });

  it('refuses once an instructor has finalized the grade', async () => {
    attemptCollection.findOne.mockResolvedValue({
      ...aiAttempt,
      gradedAt: new Date('2026-07-19T12:00:00Z'),
    });

    await expect(
      quizService.recordStudentGradeReview('student-1', 'quiz-1', 'oe-question-1', 'deny')
    ).rejects.toThrow('Grade already finalized');

    expect(attemptCollection.updateOne).not.toHaveBeenCalled();
  });
});

// The instructor review payload must carry the student's reaction so the modal
// can flag denied grades.
describe('getStudentQuizAttempt exposes studentGradeReview', () => {
  it('maps studentGradeReview through to the attempt payload', async () => {
    const attemptCollection = {
      find: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([
          {
            _id: 'attempt-1',
            questionId: 'oe-question-1',
            selectedAnswer: 'An answer',
            isCorrect: true,
            aiGraded: true,
            studentGradeReview: 'deny',
          },
          {
            _id: 'attempt-2',
            questionId: 'mcq-question-1',
            selectedAnswer: 'A',
            isCorrect: true,
          },
        ]),
      }),
    };
    const questionsCollection = {
      find: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([
          { _id: 'oe-question-1', questionType: 'open-ended', title: 'Explain X' },
          { _id: 'mcq-question-1', questionType: 'multiple-choice', title: 'Pick one' },
        ]),
      }),
    };
    databaseService.connect.mockResolvedValue({
      collection: jest.fn((name) => {
        if (name === 'grasp_student_attempt') return attemptCollection;
        if (name === 'grasp_question') return questionsCollection;
        throw new Error(`Unexpected collection: ${name}`);
      }),
    });

    const attempts = await quizService.getStudentQuizAttempt('quiz-1', 'student-1');

    const openEnded = attempts.find((a) => a.questionId === 'oe-question-1');
    const mcq = attempts.find((a) => a.questionId === 'mcq-question-1');
    expect(openEnded.studentGradeReview).toBe('deny');
    // A plain attempt with no reaction serializes as null, not undefined.
    expect(mcq.studentGradeReview).toBeNull();
  });
});
