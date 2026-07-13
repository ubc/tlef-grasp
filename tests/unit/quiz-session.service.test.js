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
});
