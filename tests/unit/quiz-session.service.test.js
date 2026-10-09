jest.mock('../../src/services/database', () => ({ connect: jest.fn() }));

const databaseService = require('../../src/services/database');
const quizSessionService = require('../../src/services/quiz-session');

describe('quiz session service', () => {
  it('reuses an existing session instead of resetting its deadline', async () => {
    const session = {
      userId: 'student-1',
      quizId: 'quiz-1',
      startedAt: new Date('2026-01-01T10:00:00Z'),
      expiresAt: new Date('2026-01-01T11:00:00Z'),
      timeLimitMinutes: 60,
    };
    const collection = { findOne: jest.fn().mockResolvedValue(session) };
    databaseService.connect.mockResolvedValue({ collection: jest.fn(() => collection) });

    await expect(
      quizSessionService.getOrCreateSession('student-1', { _id: 'quiz-1', timeLimitMinutes: 90 })
    ).resolves.toBe(session);
    expect(collection.insertOne).toBeUndefined();
  });

  it('uses the one-hour default for a new session', async () => {
    const collection = {
      findOne: jest.fn().mockResolvedValue(null),
      insertOne: jest.fn().mockResolvedValue({}),
    };
    databaseService.connect.mockResolvedValue({ collection: jest.fn(() => collection) });

    const session = await quizSessionService.getOrCreateSession('student-1', { _id: 'quiz-1' });

    expect(session.timeLimitMinutes).toBe(60);
    expect(session.expiresAt.getTime() - session.startedAt.getTime()).toBe(60 * 60 * 1000);
  });

  it('caps a new session at the scheduled quiz expiry', async () => {
    const collection = {
      findOne: jest.fn().mockResolvedValue(null),
      insertOne: jest.fn().mockResolvedValue({}),
    };
    databaseService.connect.mockResolvedValue({ collection: jest.fn(() => collection) });
    const scheduledExpiresAt = new Date(Date.now() + 15 * 60 * 1000);

    const session = await quizSessionService.getOrCreateSession(
      'student-1',
      { _id: 'quiz-1', timeLimitMinutes: 60 },
      { scheduledExpiresAt }
    );

    expect(session.expiresAt).toEqual(scheduledExpiresAt);
    expect(session.scheduledExpiresAt).toEqual(scheduledExpiresAt);
  });

  describe('getUnsubmittedQuizIds', () => {
    it('returns quizzes with recorded answers or an unsubmitted session, minus scored ones', async () => {
      const { ObjectId } = require('mongodb');
      const [answered, startedOnly, scored, untouched] = [1, 2, 3, 4].map(() => new ObjectId());
      const found = (docs) => ({ find: jest.fn(() => ({ toArray: async () => docs })) });
      const collections = {
        grasp_quiz_score: found([{ quizId: scored }]),
        grasp_student_attempt: found([{ quizId: answered }, { quizId: scored }]),
        grasp_quiz_session: found([{ quizId: startedOnly }, { quizId: scored }]),
      };
      databaseService.connect.mockResolvedValue({ collection: jest.fn((name) => collections[name]) });

      const ids = await quizSessionService.getUnsubmittedQuizIds(
        new ObjectId().toString(),
        [answered, startedOnly, scored, untouched].map(String)
      );

      expect([...ids].sort()).toEqual([answered, startedOnly].map(String).sort());
      expect(collections.grasp_quiz_session.find.mock.calls[0][0]).toMatchObject({ submittedAt: null });
    });
  });

  describe('recordQuestionCount', () => {
    it('records the served question count only when not already set', async () => {
      const collection = { updateOne: jest.fn().mockResolvedValue({}) };
      databaseService.connect.mockResolvedValue({ collection: jest.fn(() => collection) });

      await quizSessionService.recordQuestionCount('student-1', 'quiz-1', 10);

      expect(collection.updateOne).toHaveBeenCalledWith(
        { userId: 'student-1', quizId: 'quiz-1', questionCount: { $exists: false } },
        { $set: { questionCount: 10 } }
      );
    });

    it('ignores invalid counts', async () => {
      const collection = { updateOne: jest.fn() };
      databaseService.connect.mockResolvedValue({ collection: jest.fn(() => collection) });

      await quizSessionService.recordQuestionCount('student-1', 'quiz-1', 0);
      await quizSessionService.recordQuestionCount('student-1', 'quiz-1', null);
      await quizSessionService.recordQuestionCount('student-1', 'quiz-1', 'ten');

      expect(collection.updateOne).not.toHaveBeenCalled();
    });
  });

  describe('saveServedQuestions (issue #168)', () => {
    const { ObjectId } = require('mongodb');
    const userId = new ObjectId().toString();
    const quizId = new ObjectId().toString();
    const questionId = new ObjectId();

    it('keeps the pick only when none is kept yet, and returns what is kept', async () => {
      const kept = [{ questionId: new ObjectId(), phase: 1 }];
      const collection = {
        updateOne: jest.fn().mockResolvedValue({ matchedCount: 0 }),
        findOne: jest.fn().mockResolvedValue({ servedQuestions: kept }),
      };
      databaseService.connect.mockResolvedValue({ collection: jest.fn(() => collection) });

      const result = await quizSessionService.saveServedQuestions(userId, quizId, [
        { questionId: String(questionId), phase: 2, title: 'not stored' },
      ]);

      expect(collection.updateOne).toHaveBeenCalledWith(
        { userId: new ObjectId(userId), quizId: new ObjectId(quizId), servedQuestions: { $exists: false } },
        { $set: { servedQuestions: [{ questionId, phase: 2 }] } }
      );
      // Another load kept its pick first: that one wins.
      expect(result).toBe(kept);
    });

    it('returns null when there is no session to keep the pick on', async () => {
      const collection = {
        updateOne: jest.fn().mockResolvedValue({ matchedCount: 0 }),
        findOne: jest.fn().mockResolvedValue(null),
      };
      databaseService.connect.mockResolvedValue({ collection: jest.fn(() => collection) });

      await expect(
        quizSessionService.saveServedQuestions(userId, quizId, [{ questionId, phase: 1 }])
      ).resolves.toBeNull();
    });
  });
});
