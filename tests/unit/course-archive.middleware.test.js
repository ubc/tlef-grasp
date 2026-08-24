const express = require('express');
const request = require('supertest');

jest.mock('../../src/services/course', () => ({
  getCourseById: jest.fn(),
}));

jest.mock('../../src/utils/co-instructor-permissions', () => ({
  isCourseManager: jest.fn(),
}));

const { getCourseById } = require('../../src/services/course');
const { isCourseManager } = require('../../src/utils/co-instructor-permissions');
const {
  requireActiveCourse,
  ARCHIVED_ERROR,
} = require('../../src/middleware/course-archive');

const OWNER = { _id: 'owner-1' };
const OTHER = { _id: 'someone-else' };

const LIVE_COURSE = { _id: 'course-1', courseName: 'Live', archived: undefined };
const ARCHIVED_COURSE = { _id: 'course-1', courseName: 'Archived', archived: true };

// getCourseById returns null for anything that is not a valid ObjectId, so in
// production a literal path segment ("create", "by-quiz") resolves to no
// course and falls through the gate. Mirror that here rather than answering
// every id with the same course, or a layer meant for a different route would
// appear to match.
function mockCourse(course) {
  getCourseById.mockImplementation(async (id) =>
    String(id) === 'course-1' ? course : null
  );
}

// A router shaped like the real ones: a path-param route, a body/query route,
// and a route whose course is one lookup behind a child resource.
function buildApp(user = OWNER, { resolve } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });

  const router = express.Router();
  router.use('/:courseId', requireActiveCourse());
  router.use(requireActiveCourse());
  if (resolve) router.use('/by-quiz/:quizId', requireActiveCourse({ resolve }));

  const ok = (_req, res) => res.json({ reached: true });
  router.get('/by-quiz/:quizId', ok);
  router.delete('/by-quiz/:quizId', ok);
  router.get('/:courseId/things', ok);
  router.post('/:courseId/things', ok);
  router.post('/create', ok);

  app.use('/api/courses', router);
  return app;
}

describe('requireActiveCourse', () => {
  beforeEach(() => {
    getCourseById.mockReset();
    isCourseManager.mockReset().mockResolvedValue(false);
  });

  describe('a live course', () => {
    it('lets reads through', async () => {
      mockCourse(LIVE_COURSE);
      const res = await request(buildApp()).get('/api/courses/course-1/things');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ reached: true });
    });

    it('lets writes through', async () => {
      mockCourse(LIVE_COURSE);
      const res = await request(buildApp()).post('/api/courses/course-1/things');
      expect(res.status).toBe(200);
    });

    it('treats a course that has never been archived as live', async () => {
      // Existing documents have no `archived` field at all — the whole design
      // depends on that being indistinguishable from archived: false.
      mockCourse({ _id: 'course-1', courseName: 'Old' });
      const res = await request(buildApp()).post('/api/courses/course-1/things');
      expect(res.status).toBe(200);
    });
  });

  describe('an archived course, viewed by its owner', () => {
    beforeEach(() => {
      mockCourse(ARCHIVED_COURSE);
      isCourseManager.mockResolvedValue(true);
    });

    it('allows reads', async () => {
      const res = await request(buildApp()).get('/api/courses/course-1/things');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ reached: true });
    });

    it('refuses writes as read-only', async () => {
      const res = await request(buildApp()).post('/api/courses/course-1/things');
      expect(res.status).toBe(403);
      expect(res.body.error).toBe(ARCHIVED_ERROR);
      expect(res.body.message).toMatch(/read-only/i);
    });
  });

  describe('an archived course, viewed by anyone else', () => {
    beforeEach(() => {
      mockCourse(ARCHIVED_COURSE);
      isCourseManager.mockResolvedValue(false);
    });

    it('refuses reads', async () => {
      const res = await request(buildApp(OTHER)).get('/api/courses/course-1/things');
      expect(res.status).toBe(403);
      expect(res.body.error).toBe(ARCHIVED_ERROR);
      expect(res.body.message).toMatch(/archived by its instructor/i);
    });

    it('refuses writes', async () => {
      const res = await request(buildApp(OTHER)).post('/api/courses/course-1/things');
      expect(res.status).toBe(403);
      expect(res.body.error).toBe(ARCHIVED_ERROR);
    });
  });

  describe('resolving the course id', () => {
    it('reads it from the request body', async () => {
      mockCourse(ARCHIVED_COURSE);
      isCourseManager.mockResolvedValue(true);
      const res = await request(buildApp())
        .post('/api/courses/create')
        .send({ courseId: 'course-1', name: 'x' });
      expect(res.status).toBe(403);
      expect(getCourseById).toHaveBeenCalledWith('course-1');
    });

    it('uses the supplied resolver when no id is in the request', async () => {
      mockCourse(ARCHIVED_COURSE);
      isCourseManager.mockResolvedValue(true);
      const resolve = jest.fn().mockResolvedValue('course-1');

      const res = await request(buildApp(OWNER, { resolve })).delete(
        '/api/courses/by-quiz/quiz-9'
      );

      expect(resolve).toHaveBeenCalled();
      expect(res.status).toBe(403);
      expect(res.body.error).toBe(ARCHIVED_ERROR);
    });

    it('passes through when no course can be resolved', async () => {
      mockCourse(ARCHIVED_COURSE);
      const res = await request(buildApp()).post('/api/courses/create').send({});
      expect(res.status).toBe(200);
      expect(isCourseManager).not.toHaveBeenCalled();
    });

    it('passes through when the resolver throws rather than 500ing', async () => {
      // A missing quiz/material is the route handler's 404 to report, not the
      // gate's 500.
      const resolve = jest.fn().mockRejectedValue(new Error('no such quiz'));
      const res = await request(buildApp(OWNER, { resolve })).get(
        '/api/courses/by-quiz/quiz-9'
      );
      expect(res.status).toBe(200);
    });
  });
});
