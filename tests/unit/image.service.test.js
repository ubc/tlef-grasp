const { Readable, Writable } = require("stream");

jest.mock("mongodb", () => {
  const actual = jest.requireActual("mongodb");
  return { ...actual, GridFSBucket: jest.fn() };
});
jest.mock("../../src/services/database", () => ({
  connect: jest.fn(),
}));

const { ObjectId, GridFSBucket } = require("mongodb");
const databaseService = require("../../src/services/database");
const imageService = require("../../src/services/image");

// A no-op writable that mimics a GridFS upload stream (fires "finish" when
// the piped source ends).
function fakeUploadStream(id) {
  const stream = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  stream.id = id;
  return stream;
}

function mockBucket(overrides = {}) {
  const bucket = {
    openUploadStream: jest.fn(),
    openDownloadStream: jest.fn(),
    find: jest.fn(),
    delete: jest.fn(),
    ...overrides,
  };
  GridFSBucket.mockImplementation(() => bucket);
  databaseService.connect.mockResolvedValue({});
  return bucket;
}

describe("image service", () => {
  let consoleWarnSpy;

  beforeAll(() => {
    consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterAll(() => {
    consoleWarnSpy.mockRestore();
  });

  describe("uploadImage", () => {
    it("streams the buffer into GridFS and returns a JSON-safe image ref", async () => {
      const fileId = new ObjectId();
      const bucket = mockBucket();
      bucket.openUploadStream.mockReturnValue(fakeUploadStream(fileId));
      const buffer = Buffer.from("png-bytes");

      const result = await imageService.uploadImage(buffer, {
        filename: "diagram.png",
        mimeType: "image/png",
        courseId: new ObjectId(),
        uploadedBy: "user-1",
      });

      expect(result).toEqual({
        fileId: fileId.toString(),
        filename: "diagram.png",
        mimeType: "image/png",
        size: buffer.length,
      });
      expect(bucket.openUploadStream).toHaveBeenCalledWith(
        "diagram.png",
        expect.objectContaining({
          contentType: "image/png",
          metadata: expect.objectContaining({
            uploadedBy: "user-1",
            originalName: "diagram.png",
          }),
        })
      );
      // courseId is stored as a string so access checks compare consistently.
      const metadata = bucket.openUploadStream.mock.calls[0][1].metadata;
      expect(typeof metadata.courseId).toBe("string");
    });
  });

  describe("getImageStream / downloadImageBuffer", () => {
    it("returns null for a malformed fileId without touching the database", async () => {
      const result = await imageService.getImageStream("not-an-object-id");

      expect(result).toBe(null);
      expect(databaseService.connect).not.toHaveBeenCalled();
    });

    it("returns null when the file does not exist", async () => {
      const bucket = mockBucket();
      bucket.find.mockReturnValue({ next: jest.fn().mockResolvedValue(null) });

      const result = await imageService.getImageStream(new ObjectId().toString());

      expect(result).toBe(null);
    });

    it("downloads the whole file into one buffer for QTI export", async () => {
      const bucket = mockBucket();
      const file = { _id: new ObjectId(), contentType: "image/png" };
      bucket.find.mockReturnValue({ next: jest.fn().mockResolvedValue(file) });
      bucket.openDownloadStream.mockReturnValue(
        Readable.from([Buffer.from("chunk-1"), Buffer.from("chunk-2")])
      );

      const buffer = await imageService.downloadImageBuffer(file._id.toString());

      expect(buffer.toString()).toBe("chunk-1chunk-2");
    });

    it("returns null from downloadImageBuffer when the file is missing", async () => {
      const bucket = mockBucket();
      bucket.find.mockReturnValue({ next: jest.fn().mockResolvedValue(null) });

      const buffer = await imageService.downloadImageBuffer(new ObjectId().toString());

      expect(buffer).toBe(null);
    });
  });

  describe("deleteImage / deleteImages", () => {
    it("deletes each referenced file and skips malformed ids", async () => {
      const bucket = mockBucket();
      bucket.delete.mockResolvedValue();
      const idA = new ObjectId().toString();
      const idB = new ObjectId().toString();

      await imageService.deleteImages([idA, "not-an-id", idB]);

      expect(bucket.delete).toHaveBeenCalledTimes(2);
      expect(bucket.delete.mock.calls.map(([id]) => id.toString())).toEqual([idA, idB]);
    });

    it("swallows FileNotFound errors — cleanup is best-effort", async () => {
      const bucket = mockBucket();
      bucket.delete.mockRejectedValue(new Error("FileNotFound"));

      await expect(imageService.deleteImage(new ObjectId().toString())).resolves.toBeUndefined();
      expect(consoleWarnSpy).toHaveBeenCalled();
    });
  });

  describe("collectQuestionImageIds", () => {
    it("collects stem images, the legacy single image, and legacy option images", () => {
      const stemA = new ObjectId().toString();
      const stemB = new ObjectId().toString();
      const legacyStem = new ObjectId().toString();
      const optionImage = new ObjectId().toString();

      const ids = imageService.collectQuestionImageIds({
        stemImages: [{ fileId: stemA }, { fileId: stemB }],
        stemImage: { fileId: legacyStem },
        options: {
          A: { text: "4", image: { fileId: optionImage } },
          B: { text: "5" },
        },
      });

      expect(ids).toEqual([stemA, stemB, legacyStem, optionImage]);
    });

    it("ignores malformed refs and empty questions", () => {
      expect(imageService.collectQuestionImageIds(null)).toEqual([]);
      expect(imageService.collectQuestionImageIds({})).toEqual([]);
      expect(
        imageService.collectQuestionImageIds({
          stemImages: [null, "garbage", {}],
          options: { A: "just a string" },
        })
      ).toEqual([]);
    });
  });
});
