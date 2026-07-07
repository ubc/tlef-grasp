const express = require('express');
const request = require('supertest');

jest.mock('../../src/services/achievement', () => ({
  saveAchievement: jest.fn(),
  getUserAchievements: jest.fn(),
  getAchievementCounts: jest.fn(),
}));

jest.mock('../../src/services/user-course', () => ({
  isUserInCourse: jest.fn(),
}));

const achievementService = require('../../src/services/achievement');
const { isUserInCourse } = require('../../src/services/user-course');
const achievementRouter = require('../../src/routes/achievement');

function buildApp(user = { _id: 'user-1' }) {
  const app = express();
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.use('/achievement', achievementRouter);
  return app;
}

describe('achievement routes', () => {
  let consoleErrorSpy;

  beforeAll(() => {
    // Error-path tests deliberately reject service calls; the controller logs
    // via console.error before responding. Suppress that expected noise.
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterAll(() => {
    consoleErrorSpy.mockRestore();
  });

  beforeEach(() => {
    achievementService.saveAchievement.mockReset();
    achievementService.getUserAchievements.mockReset();
    achievementService.getAchievementCounts.mockReset();
    isUserInCourse.mockReset();
  });

  describe('POST /achievement', () => {
    it('rejects incomplete achievement payloads', async () => {
      const res = await request(buildApp())
        .post('/achievement')
        .send({ userId: 'user-1', courseId: 'course-1' });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        success: false,
        error: 'User ID, Course ID, Quiz ID, and type are required',
      });
      expect(isUserInCourse).not.toHaveBeenCalled();
      expect(achievementService.saveAchievement).not.toHaveBeenCalled();
    });

    it('forbids saving achievements for users outside the course', async () => {
      isUserInCourse.mockResolvedValue(false);

      const res = await request(buildApp()).post('/achievement').send({
        userId: 'user-1',
        courseId: 'course-1',
        quizId: 'quiz-1',
        type: 'quiz_completed',
      });

      expect(res.status).toBe(403);
      expect(res.body).toEqual({
        success: false,
        error: 'User is not in course',
      });
      expect(isUserInCourse).toHaveBeenCalledWith('user-1', 'course-1');
      expect(achievementService.saveAchievement).not.toHaveBeenCalled();
    });

    it('saves new achievements and reports duplicate awards as already existing', async () => {
      isUserInCourse.mockResolvedValue(true);
      achievementService.saveAchievement
        .mockResolvedValueOnce({ _id: 'achievement-1', type: 'quiz_completed' })
        .mockResolvedValueOnce(null);

      const first = await request(buildApp()).post('/achievement').send({
        userId: 'user-1',
        courseId: 'course-1',
        quizId: 'quiz-1',
        type: 'quiz_completed',
      });

      expect(first.status).toBe(200);
      expect(first.body).toEqual({
        success: true,
        data: { _id: 'achievement-1', type: 'quiz_completed' },
        message: 'Achievement saved successfully',
      });

      const second = await request(buildApp()).post('/achievement').send({
        userId: 'user-1',
        courseId: 'course-1',
        quizId: 'quiz-1',
        type: 'quiz_completed',
      });

      expect(second.status).toBe(200);
      expect(second.body).toEqual({
        success: true,
        data: null,
        message: 'Achievement already exists',
      });
      expect(achievementService.saveAchievement).toHaveBeenCalledWith(
        'user-1',
        'course-1',
        'quiz-1',
        'quiz_completed'
      );
    });

    it('returns service errors as JSON 500 responses', async () => {
      isUserInCourse.mockResolvedValue(true);
      achievementService.saveAchievement.mockRejectedValue(new Error('write failed'));

      const res = await request(buildApp()).post('/achievement').send({
        userId: 'user-1',
        courseId: 'course-1',
        quizId: 'quiz-1',
        type: 'quiz_completed',
      });

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ success: false, error: 'write failed' });
    });
  });

  describe('GET /achievement/my', () => {
    it('returns the current user achievements with count', async () => {
      achievementService.getUserAchievements.mockResolvedValue([
        { _id: 'a1' },
        { _id: 'a2' },
      ]);

      const res = await request(buildApp({ _id: { toString: () => 'user-1' } }))
        .get('/achievement/my')
        .query({ courseId: 'course-1' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        data: [{ _id: 'a1' }, { _id: 'a2' }],
        count: 2,
      });
      expect(achievementService.getUserAchievements).toHaveBeenCalledWith(
        'user-1',
        'course-1'
      );
    });

    it('returns 401 when no current user id is available', async () => {
      const res = await request(buildApp({})).get('/achievement/my');

      expect(res.status).toBe(401);
      expect(res.body).toEqual({
        success: false,
        error: 'User not authenticated',
      });
      expect(achievementService.getUserAchievements).not.toHaveBeenCalled();
    });

    it('returns JSON 500 when achievement lookup fails', async () => {
      achievementService.getUserAchievements.mockRejectedValue(new Error('read failed'));

      const res = await request(buildApp()).get('/achievement/my');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ success: false, error: 'read failed' });
    });
  });

  describe('GET /achievement/my/counts', () => {
    it('returns achievement counts for the current user', async () => {
      achievementService.getAchievementCounts.mockResolvedValue({
        total: 3,
        quiz_completed: 2,
        quiz_perfect: 1,
      });

      const res = await request(buildApp({ id: 'user-1' }))
        .get('/achievement/my/counts')
        .query({ courseId: 'course-1' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        data: {
          total: 3,
          quiz_completed: 2,
          quiz_perfect: 1,
        },
      });
      expect(achievementService.getAchievementCounts).toHaveBeenCalledWith(
        'user-1',
        'course-1'
      );
    });

    it('returns 401 without a current user id and JSON 500 on service errors', async () => {
      const unauthenticated = await request(buildApp({})).get('/achievement/my/counts');

      expect(unauthenticated.status).toBe(401);
      expect(unauthenticated.body).toEqual({
        success: false,
        error: 'User not authenticated',
      });

      achievementService.getAchievementCounts.mockRejectedValue(
        new Error('count failed')
      );
      const failed = await request(buildApp()).get('/achievement/my/counts');

      expect(failed.status).toBe(500);
      expect(failed.body).toEqual({ success: false, error: 'count failed' });
    });
  });
});
