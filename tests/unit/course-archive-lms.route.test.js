// LMS section links and question-flag triage are the two course-scoped areas
// that name neither a courseId nor a quiz in a way the generic gate layers
// catch, so both needed wiring of their own.

const express = require('express');
const request = require('supertest');

jest.mock('../../src/services/course', () => ({
  getCourseById: jest.fn(),
}));

jest.mock('../../src/utils/co-instructor-permissions', () => ({
  isCourseManager: jest.fn(),
}));

jest.mock('../../src/services/lms-section-link', () => ({
  removeSectionLmsLink: jest.fn(),
}));

jest.mock('../../src/middleware/lms-section-access', () => ({
  requireOwnedSection: (_req, _res, next) => next(),
}));

jest.mock('../../src/services/quiz-question-flag', () => ({
  getFlagById: jest.fn(),
}));

const { getCourseById } = require('../../src/services/course');
const { isCourseManager } = require('../../src/utils/co-instructor-permissions');
const lmsSectionLinkService = require('../../src/services/lms-section-link');
const flagService = require('../../src/services/quiz-question-flag');
const { resolveCourseFromFlag } = require('../../src/middleware/course-archive');
const lmsRouter = require('../../src/routes/lms');

const COURSE_ID = '507f1f77bcf86cd799439011';
const SECTION_ID = '507f1f77bcf86cd799439022';
const FLAG_ID = '507f1f77bcf86cd799439033';

function buildApp(user = { _id: 'co-instructor' }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.use('/api/lms', lmsRouter);
  return app;
}

describe('LMS routes on an archived course', () => {
  beforeEach(() => {
    getCourseById.mockReset();
    isCourseManager.mockReset().mockResolvedValue(false);
    lmsSectionLinkService.removeSectionLmsLink.mockReset().mockResolvedValue(true);
  });

  it('refuses to unlink a section from an archived course', async () => {
    getCourseById.mockResolvedValue({ _id: COURSE_ID, archived: true });

    const res = await request(buildApp()).delete(
      `/api/lms/courses/${COURSE_ID}/sections/${SECTION_ID}/link`
    );

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('course_archived');
    expect(lmsSectionLinkService.removeSectionLmsLink).not.toHaveBeenCalled();
  });

  it('refuses the owner too, since unlinking is a write', async () => {
    getCourseById.mockResolvedValue({ _id: COURSE_ID, archived: true });
    isCourseManager.mockResolvedValue(true);

    const res = await request(buildApp({ _id: 'owner-1' })).delete(
      `/api/lms/courses/${COURSE_ID}/sections/${SECTION_ID}/link`
    );

    expect(res.status).toBe(403);
    expect(lmsSectionLinkService.removeSectionLmsLink).not.toHaveBeenCalled();
  });

  it('still unlinks on a live course', async () => {
    getCourseById.mockResolvedValue({ _id: COURSE_ID });

    const res = await request(buildApp()).delete(
      `/api/lms/courses/${COURSE_ID}/sections/${SECTION_ID}/link`
    );

    expect(res.status).toBe(204);
    expect(lmsSectionLinkService.removeSectionLmsLink).toHaveBeenCalledWith(
      COURSE_ID,
      SECTION_ID
    );
  });
});

describe('resolveCourseFromFlag', () => {
  beforeEach(() => {
    flagService.getFlagById.mockReset();
  });

  it('reads the course off the flag document', async () => {
    flagService.getFlagById.mockResolvedValue({ _id: FLAG_ID, courseId: COURSE_ID });

    const resolved = await resolveCourseFromFlag({ params: { flagId: FLAG_ID } });

    expect(resolved).toBe(COURSE_ID);
  });

  it('skips the lookup for sibling routes that are not flag ids', async () => {
    // "/flags/mine" and "/flags/course/:courseId" both match "/flags/:flagId".
    expect(await resolveCourseFromFlag({ params: { flagId: 'mine' } })).toBeNull();
    expect(await resolveCourseFromFlag({ params: { flagId: 'course' } })).toBeNull();
    expect(flagService.getFlagById).not.toHaveBeenCalled();
  });

  it('returns null for a flag that no longer exists', async () => {
    flagService.getFlagById.mockResolvedValue(null);
    expect(await resolveCourseFromFlag({ params: { flagId: FLAG_ID } })).toBeNull();
  });
});
