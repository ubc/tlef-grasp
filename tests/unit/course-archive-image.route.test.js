// Images are the one course asset that does not live in a grasp_* collection:
// they sit in GridFS with their course on the file metadata. That made them
// easy to miss when archiving was gated, and a miss matters — a student
// rendering a quiz fetches these directly, so an ungated image route leaves
// archived course content readable after the hard cut.

const express = require('express');
const request = require('supertest');

jest.mock('../../src/services/course', () => ({
  getCourseById: jest.fn(),
}));

jest.mock('../../src/utils/co-instructor-permissions', () => ({
  isCourseManager: jest.fn(),
}));

jest.mock('../../src/services/image', () => ({
  getImageCourseId: jest.fn(),
  uploadImage: jest.fn(),
  getImageStream: jest.fn(),
  deleteImage: jest.fn(),
}));

jest.mock('../../src/controllers/image', () => ({
  uploadImageHandler: jest.fn((_req, res) => res.json({ reached: 'upload' })),
  getImageHandler: jest.fn((_req, res) => res.json({ reached: 'get' })),
  deleteImageHandler: jest.fn((_req, res) => res.json({ reached: 'delete' })),
}));

jest.mock('../../src/middleware/auth', () => ({
  requireRole: () => (_req, _res, next) => next(),
}));

const { getCourseById } = require('../../src/services/course');
const { isCourseManager } = require('../../src/utils/co-instructor-permissions');
const imageService = require('../../src/services/image');
const imageRouter = require('../../src/routes/image');

const FILE_ID = '507f1f77bcf86cd799439099';
const COURSE_ID = '507f1f77bcf86cd799439011';

function buildApp(user = { _id: 'student-1' }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.use('/api/image', imageRouter);
  return app;
}

describe('image routes on an archived course', () => {
  beforeEach(() => {
    getCourseById.mockReset();
    isCourseManager.mockReset().mockResolvedValue(false);
    imageService.getImageCourseId.mockReset().mockResolvedValue(COURSE_ID);
  });

  it('refuses a student fetching an image from an archived course', async () => {
    getCourseById.mockResolvedValue({ _id: COURSE_ID, archived: true });

    const res = await request(buildApp()).get(`/api/image/${FILE_ID}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('course_archived');
  });

  it('still serves an image from a live course', async () => {
    getCourseById.mockResolvedValue({ _id: COURSE_ID });

    const res = await request(buildApp()).get(`/api/image/${FILE_ID}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reached: 'get' });
  });

  it('lets the owner read an archived image but not delete it', async () => {
    getCourseById.mockResolvedValue({ _id: COURSE_ID, archived: true });
    isCourseManager.mockResolvedValue(true);

    const read = await request(buildApp({ _id: 'owner-1' })).get(
      `/api/image/${FILE_ID}`
    );
    expect(read.status).toBe(200);

    const removed = await request(buildApp({ _id: 'owner-1' })).delete(
      `/api/image/${FILE_ID}`
    );
    expect(removed.status).toBe(403);
    expect(removed.body.error).toBe('course_archived');
  });

  it('does not look up a file id that cannot be an ObjectId', async () => {
    getCourseById.mockResolvedValue(null);

    await request(buildApp()).get('/api/image/not-an-id');

    expect(imageService.getImageCourseId).not.toHaveBeenCalled();
  });
});
