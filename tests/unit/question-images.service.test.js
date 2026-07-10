const { ObjectId } = require("mongodb");

jest.mock("../../src/services/database", () => ({
  connect: jest.fn(),
}));
// Keep the real collectQuestionImageIds (the cleanup diffing depends on it)
// but stub out the GridFS deletes.
jest.mock("../../src/services/image", () => ({
  ...jest.requireActual("../../src/services/image"),
  deleteImages: jest.fn(),
}));

const databaseService = require("../../src/services/database");
const { deleteImages } = require("../../src/services/image");
const questionService = require("../../src/services/question");

const imageRef = (fileId, overrides = {}) => ({
  fileId,
  filename: "diagram.png",
  mimeType: "image/png",
  size: 1234,
  caption: "A diagram",
  ...overrides,
});

function mockCollections() {
  const questionCollection = {
    insertOne: jest.fn().mockResolvedValue({ insertedId: new ObjectId() }),
    findOne: jest.fn().mockResolvedValue(null),
    updateOne: jest.fn().mockResolvedValue({ acknowledged: true, modifiedCount: 1 }),
    deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
  };
  const relationshipCollection = {
    deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }),
  };
  databaseService.connect.mockResolvedValue({
    collection: jest.fn((name) =>
      name === "grasp_quiz_question" ? relationshipCollection : questionCollection
    ),
  });
  return { questionCollection, relationshipCollection };
}

describe("question service image handling", () => {
  let consoleLogSpy;
  let consoleErrorSpy;

  beforeAll(() => {
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterAll(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe("saveQuestion", () => {
    it("persists only well-formed image refs with capped captions", async () => {
      const { questionCollection } = mockCollections();
      const validId = new ObjectId().toString();

      await questionService.saveQuestion(new ObjectId().toString(), {
        title: "Cell structure",
        stem: "Which organelle is shown?",
        stemImages: [
          imageRef(validId, { caption: "x".repeat(400) }),
          imageRef("not-an-object-id"), // malformed fileId → dropped
          "garbage", // not an object → dropped
          null,
        ],
        options: { A: { text: "Nucleus" }, B: { text: "Ribosome" } },
        correctAnswer: "A",
      });

      const inserted = questionCollection.insertOne.mock.calls[0][0];
      expect(inserted.stemImages).toEqual([
        expect.objectContaining({ fileId: validId, caption: "x".repeat(300) }),
      ]);
    });

    it("accepts a legacy single stemImage and legacy alt text", async () => {
      const { questionCollection } = mockCollections();
      const validId = new ObjectId().toString();

      await questionService.saveQuestion(new ObjectId().toString(), {
        title: "Legacy question",
        stem: "Stem",
        stemImage: { fileId: validId, alt: "old alt text" },
        options: {},
        correctAnswer: "A",
      });

      const inserted = questionCollection.insertOne.mock.calls[0][0];
      expect(inserted.stemImages).toEqual([
        expect.objectContaining({ fileId: validId, caption: "old alt text" }),
      ]);
    });

    it("strips legacy per-option images — images live on the stem only", async () => {
      const { questionCollection } = mockCollections();

      await questionService.saveQuestion(new ObjectId().toString(), {
        title: "MCQ",
        stem: "Stem",
        options: {
          A: { text: "4", image: { fileId: new ObjectId().toString() } },
          B: { text: "5", feedback: "Close" },
        },
        correctAnswer: "A",
      });

      const inserted = questionCollection.insertOne.mock.calls[0][0];
      expect(inserted.options.A).toEqual({ text: "4" });
      expect(inserted.options.B).toEqual({ text: "5", feedback: "Close" });
    });
  });

  describe("updateQuestion", () => {
    it("replaces stemImages, clears the legacy field, and deletes removed files", async () => {
      const { questionCollection } = mockCollections();
      const keptId = new ObjectId().toString();
      const removedId = new ObjectId().toString();
      const questionId = new ObjectId();
      questionCollection.findOne.mockResolvedValue({
        _id: questionId,
        stemImages: [imageRef(keptId), imageRef(removedId)],
      });

      await questionService.updateQuestion(questionId.toString(), {
        stemImages: [imageRef(keptId)],
      });

      const [, { $set: update }] = questionCollection.updateOne.mock.calls[0];
      expect(update.stemImages).toEqual([expect.objectContaining({ fileId: keptId })]);
      expect(update.stemImage).toBe(null);
      expect(deleteImages).toHaveBeenCalledWith([removedId]);
    });

    it("cleans up legacy option images when the options are rewritten", async () => {
      const { questionCollection } = mockCollections();
      const optionImageId = new ObjectId().toString();
      const questionId = new ObjectId();
      questionCollection.findOne.mockResolvedValue({
        _id: questionId,
        options: { A: { text: "4", image: { fileId: optionImageId } } },
      });

      await questionService.updateQuestion(questionId.toString(), {
        options: { A: { text: "4", image: { fileId: optionImageId } } },
      });

      const [, { $set: update }] = questionCollection.updateOne.mock.calls[0];
      expect(update.options.A).toEqual({ text: "4" });
      expect(deleteImages).toHaveBeenCalledWith([optionImageId]);
    });

    it("does not fetch the doc or delete images when the update never touches them", async () => {
      const { questionCollection } = mockCollections();

      await questionService.updateQuestion(new ObjectId().toString(), {
        title: "Renamed only",
      });

      expect(questionCollection.findOne).not.toHaveBeenCalled();
      expect(deleteImages).not.toHaveBeenCalled();
    });

    it("keeps files that remain referenced after the update", async () => {
      const { questionCollection } = mockCollections();
      const keptId = new ObjectId().toString();
      const questionId = new ObjectId();
      questionCollection.findOne.mockResolvedValue({
        _id: questionId,
        stemImages: [imageRef(keptId)],
      });

      await questionService.updateQuestion(questionId.toString(), {
        stemImages: [imageRef(keptId, { caption: "updated caption" })],
      });

      expect(deleteImages).not.toHaveBeenCalled();
    });
  });

  describe("deleteQuestion", () => {
    it("deletes every image attached to the removed question", async () => {
      const { questionCollection, relationshipCollection } = mockCollections();
      const stemId = new ObjectId().toString();
      const legacyStemId = new ObjectId().toString();
      const optionImageId = new ObjectId().toString();
      const questionId = new ObjectId();
      questionCollection.findOne.mockResolvedValue({
        _id: questionId,
        stemImages: [imageRef(stemId)],
        stemImage: { fileId: legacyStemId },
        options: { A: { text: "4", image: { fileId: optionImageId } } },
      });

      const result = await questionService.deleteQuestion(questionId.toString());

      expect(result.deletedCount).toBe(1);
      expect(relationshipCollection.deleteMany).toHaveBeenCalledWith({
        questionId: expect.any(ObjectId),
      });
      expect(deleteImages).toHaveBeenCalledWith([stemId, legacyStemId, optionImageId]);
    });

    it("skips image cleanup when the question had none", async () => {
      const { questionCollection } = mockCollections();
      const questionId = new ObjectId();
      questionCollection.findOne.mockResolvedValue({ _id: questionId, title: "Plain" });

      await questionService.deleteQuestion(questionId.toString());

      expect(deleteImages).not.toHaveBeenCalled();
    });
  });
});
