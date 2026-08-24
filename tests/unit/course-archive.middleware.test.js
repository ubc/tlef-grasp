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

    // Three handlers name the course something other than `courseId`. Each one
    // that the gate fails to recognise is an endpoint a co-instructor can still
    // drive against an archived course.
    it('reads metadata.courseId (RAG add-document)', async () => {
      mockCourse(ARCHIVED_COURSE);
      isCourseManager.mockResolvedValue(true);

      const res = await request(buildApp())
        .post('/api/courses/create')
        .send({ content: 'x', metadata: { courseId: 'course-1' } });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe(ARCHIVED_ERROR);
    });

    it('reads `course` (question export names it that)', async () => {
      mockCourse(ARCHIVED_COURSE);
      isCourseManager.mockResolvedValue(true);

      const res = await request(buildApp())
        .post('/api/courses/create')
        .send({ course: 'course-1', questionIds: ['q1'] });

      expect(res.status).toBe(403);
    });

    it('reads questions[0].courseId (question review)', async () => {
      mockCourse(ARCHIVED_COURSE);
      isCourseManager.mockResolvedValue(true);

      const res = await request(buildApp())
        .post('/api/courses/create')
        .send({ questions: [{ courseId: 'course-1', questionTitle: 'x' }] });

      expect(res.status).toBe(403);
    });

    it('ignores a non-id `course` object rather than treating it as an id', async () => {
      mockCourse(ARCHIVED_COURSE);
      const res = await request(buildApp())
        .post('/api/courses/create')
        .send({ course: { name: 'not an id' } });

      expect(res.status).toBe(200);
      // The "/:courseId" layer still resolves the literal path segment; what
      // matters is that the object was never treated as an id.
      for (const [id] of getCourseById.mock.calls) {
        expect(typeof id).toBe('string');
      }
    });

    it('checks a course once per request even across several gate layers', async () => {
      // Routers mount two or three layers of this gate; the later ones must not
      // re-read the same course document.
      mockCourse(LIVE_COURSE);

      const res = await request(buildApp()).get('/api/courses/course-1/things');

      expect(res.status).toBe(200);
      expect(getCourseById).toHaveBeenCalledTimes(1);
    });

    // The request-supplied id is attacker-controlled. If naming any live course
    // suppressed the resolver, a student could read an archived course's images
    // or quizzes with `?courseId=<a course they are still in>`.
    it('still resolves the authoritative course when the request names another', async () => {
      getCourseById.mockImplementation(async (id) =>
        String(id) === 'course-1'
          ? ARCHIVED_COURSE
          : { _id: String(id), courseName: 'Decoy', archived: undefined }
      );
      const resolve = jest.fn().mockResolvedValue('course-1');

      const res = await request(buildApp({ _id: 'student-1' }, { resolve }))
        .get('/api/courses/by-quiz/quiz-9')
        .query({ courseId: 'a-live-course' });

      expect(resolve).toHaveBeenCalled();
      expect(res.status).toBe(403);
      expect(res.body.error).toBe(ARCHIVED_ERROR);
    });

    it('refuses when the decoy is live but the resolved course is archived, on writes too', async () => {
      getCourseById.mockImplementation(async (id) =>
        String(id) === 'course-1'
          ? ARCHIVED_COURSE
          : { _id: String(id), courseName: 'Decoy' }
      );
      isCourseManager.mockResolvedValue(true);
      const resolve = jest.fn().mockResolvedValue('course-1');

      const res = await request(buildApp(OWNER, { resolve }))
        .delete('/api/courses/by-quiz/quiz-9')
        .query({ courseId: 'a-live-course' });

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/read-only/i);
    });

    it('allows the request when neither the named nor the resolved course is archived', async () => {
      getCourseById.mockResolvedValue({ _id: 'x', courseName: 'Live' });
      const resolve = jest.fn().mockResolvedValue('course-1');

      const res = await request(buildApp(OWNER, { resolve }))
        .get('/api/courses/by-quiz/quiz-9')
        .query({ courseId: 'a-live-course' });

      expect(res.status).toBe(200);
      expect(resolve).toHaveBeenCalled();
    });

    it('passes through when no course can be resolved', async () => {
      mockCourse(ARCHIVED_COURSE);
      const res = await request(buildApp()).post('/api/courses/create').send({});
      expect(res.status).toBe(200);
      expect(isCourseManager).not.toHaveBeenCalled();
    });

    it('refuses the request when the resolver throws', async () => {
      // A missing quiz/material resolves to null and leaves the handler to
      // report its own 404. A throw means the lookup itself failed, so the gate
      // cannot tell whether the course behind it is archived — continuing would
      // let the request act on an archived course if the handler's own lookup
      // then succeeded.
      const resolve = jest.fn().mockRejectedValue(new Error('connection reset'));

      const res = await request(buildApp(OWNER, { resolve })).get(
        '/api/courses/by-quiz/quiz-9'
      );

      expect(res.status).toBe(500);
    });

    it('lets a resolver report a missing resource as null and passes through', async () => {
      const resolve = jest.fn().mockResolvedValue(null);

      const res = await request(buildApp(OWNER, { resolve })).get(
        '/api/courses/by-quiz/quiz-9'
      );

      expect(res.status).toBe(200);
    });
  });
});
