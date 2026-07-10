const express = require("express");
const request = require("supertest");
const { Readable } = require("stream");
const { ObjectId } = require("mongodb");

jest.mock("../../src/services/image", () => ({
  uploadImage: jest.fn(),
  getImageStream: jest.fn(),
  deleteImage: jest.fn(),
}));
jest.mock("../../src/services/user-course", () => ({
  isUserInCourse: jest.fn(),
}));
jest.mock("../../src/utils/co-instructor-permissions", () => ({
  assertCoInstructorPermission: jest.fn(),
  PERMISSION_KEYS: { QUESTION_BANK: "questionBank" },
}));
jest.mock("../../src/utils/auth", () => ({
  ROLES: { FACULTY: "faculty", STAFF: "staff", STUDENT: "student" },
}));
jest.mock("../../src/middleware/auth", () => ({
  requireRole: () => (_req, _res, next) => next(),
}));

const imageService = require("../../src/services/image");
const { isUserInCourse } = require("../../src/services/user-course");
const { assertCoInstructorPermission } = require("../../src/utils/co-instructor-permissions");
const imageRouter = require("../../src/routes/image");

const USER_ID = "staff-1";
const COURSE_ID = new ObjectId().toString();
const FILE_ID = new ObjectId().toString();

// Minimal valid file signatures (magic bytes) padded past the 12-byte sniff window.
const PNG_BUFFER = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(8),
]);
const GIF_BUFFER = Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(8)]);

function buildApp(user = { _id: USER_ID }) {
  const app = express();
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.use("/api/image", imageRouter);
  return app;
}

describe("question image routes", () => {
  let consoleErrorSpy;
  let consoleWarnSpy;

  beforeAll(() => {
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterAll(() => {
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  beforeEach(() => {
    isUserInCourse.mockResolvedValue(true);
    assertCoInstructorPermission.mockResolvedValue(true);
  });

  describe("POST /api/image/upload", () => {
    it("stores a valid PNG and returns its image ref", async () => {
      const imageRef = {
        fileId: FILE_ID,
        filename: "diagram.png",
        mimeType: "image/png",
        size: PNG_BUFFER.length,
      };
      imageService.uploadImage.mockResolvedValue(imageRef);

      const response = await request(buildApp())
        .post("/api/image/upload")
        .field("courseId", COURSE_ID)
        .attach("image", PNG_BUFFER, { filename: "diagram.png", contentType: "image/png" });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true, image: imageRef });
      expect(imageService.uploadImage).toHaveBeenCalledWith(expect.any(Buffer), {
        filename: "diagram.png",
        mimeType: "image/png",
        courseId: COURSE_ID,
        uploadedBy: USER_ID,
      });
    });

    it("rejects a file whose magic bytes do not match its claimed type", async () => {
      const response = await request(buildApp())
        .post("/api/image/upload")
        .field("courseId", COURSE_ID)
        // GIF bytes disguised with a .png name and PNG content type.
        .attach("image", GIF_BUFFER, { filename: "fake.png", contentType: "image/png" });

      expect(response.status).toBe(400);
      expect(response.body.error).toMatch(/unsupported image type/i);
      expect(imageService.uploadImage).not.toHaveBeenCalled();
    });

    it("rejects disallowed formats such as SVG", async () => {
      const response = await request(buildApp())
        .post("/api/image/upload")
        .field("courseId", COURSE_ID)
        .attach("image", Buffer.from("<svg></svg>padding"), {
          filename: "sketch.svg",
          contentType: "image/svg+xml",
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toMatch(/unsupported image type/i);
      expect(imageService.uploadImage).not.toHaveBeenCalled();
    });

    it("rejects files over the 5 MB limit with a clean 400", async () => {
      const oversized = Buffer.concat([PNG_BUFFER, Buffer.alloc(5 * 1024 * 1024)]);

      const response = await request(buildApp())
        .post("/api/image/upload")
        .field("courseId", COURSE_ID)
        .attach("image", oversized, { filename: "huge.png", contentType: "image/png" });

      expect(response.status).toBe(400);
      expect(response.body.error).toMatch(/too large/i);
      expect(imageService.uploadImage).not.toHaveBeenCalled();
    });

    it("requires a file and a courseId", async () => {
      const noFile = await request(buildApp())
        .post("/api/image/upload")
        .field("courseId", COURSE_ID);
      expect(noFile.status).toBe(400);
      expect(noFile.body.error).toMatch(/no image/i);

      const noCourse = await request(buildApp())
        .post("/api/image/upload")
        .attach("image", PNG_BUFFER, { filename: "diagram.png", contentType: "image/png" });
      expect(noCourse.status).toBe(400);
      expect(noCourse.body.error).toMatch(/courseId/);
      expect(imageService.uploadImage).not.toHaveBeenCalled();
    });

    it("rejects uploads from users outside the course", async () => {
      isUserInCourse.mockResolvedValue(false);

      const response = await request(buildApp())
        .post("/api/image/upload")
        .field("courseId", COURSE_ID)
        .attach("image", PNG_BUFFER, { filename: "diagram.png", contentType: "image/png" });

      expect(response.status).toBe(403);
      expect(imageService.uploadImage).not.toHaveBeenCalled();
    });
  });

  describe("GET /api/image/:fileId", () => {
    const fileDoc = (overrides = {}) => ({
      contentType: "image/png",
      length: PNG_BUFFER.length,
      metadata: { courseId: COURSE_ID },
      ...overrides,
    });

    it("streams the image with immutable private caching headers", async () => {
      imageService.getImageStream.mockResolvedValue({
        stream: Readable.from([PNG_BUFFER]),
        file: fileDoc(),
      });

      const response = await request(buildApp()).get(`/api/image/${FILE_ID}`);

      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toBe("image/png");
      expect(response.headers["cache-control"]).toBe("private, max-age=31536000, immutable");
      expect(response.headers["content-disposition"]).toBe("inline");
      expect(response.body.equals(PNG_BUFFER)).toBe(true);
    });

    it("returns 404 when the image does not exist", async () => {
      imageService.getImageStream.mockResolvedValue(null);

      const response = await request(buildApp()).get(`/api/image/${FILE_ID}`);

      expect(response.status).toBe(404);
    });

    it("blocks users who are not enrolled in the image's course", async () => {
      isUserInCourse.mockResolvedValue(false);
      imageService.getImageStream.mockResolvedValue({
        stream: Readable.from([PNG_BUFFER]),
        file: fileDoc(),
      });

      const response = await request(buildApp({ _id: "outsider" })).get(
        `/api/image/${FILE_ID}`
      );

      expect(response.status).toBe(403);
    });
  });

  describe("DELETE /api/image/:fileId", () => {
    it("deletes an existing image after checking course membership", async () => {
      imageService.getImageStream.mockResolvedValue({
        stream: Readable.from([PNG_BUFFER]),
        file: { metadata: { courseId: COURSE_ID } },
      });
      imageService.deleteImage.mockResolvedValue();

      const response = await request(buildApp()).delete(`/api/image/${FILE_ID}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true });
      expect(isUserInCourse).toHaveBeenCalledWith(USER_ID, COURSE_ID);
      expect(imageService.deleteImage).toHaveBeenCalledWith(FILE_ID);
    });

    it("treats deleting a missing image as success (idempotent)", async () => {
      imageService.getImageStream.mockResolvedValue(null);

      const response = await request(buildApp()).delete(`/api/image/${FILE_ID}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true });
      expect(imageService.deleteImage).not.toHaveBeenCalled();
    });

    it("blocks deletes from users outside the course", async () => {
      isUserInCourse.mockResolvedValue(false);
      imageService.getImageStream.mockResolvedValue({
        stream: Readable.from([PNG_BUFFER]),
        file: { metadata: { courseId: COURSE_ID } },
      });

      const response = await request(buildApp({ _id: "outsider" })).delete(
        `/api/image/${FILE_ID}`
      );

      expect(response.status).toBe(403);
      expect(imageService.deleteImage).not.toHaveBeenCalled();
    });
  });
});
