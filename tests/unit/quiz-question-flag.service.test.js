const { ObjectId } = require("mongodb");

jest.mock("../../src/services/database", () => ({
  connect: jest.fn(),
}));

const databaseService = require("../../src/services/database");
const flagService = require("../../src/services/quiz-question-flag");

describe("quiz question flag service", () => {
  const courseId = new ObjectId().toString();
  const quizId = new ObjectId().toString();
  const questionId = new ObjectId().toString();
  const studentId = new ObjectId().toString();

  it("upserts one student report and reopens it as pending", async () => {
    const savedFlag = {
      _id: new ObjectId(),
      courseId: new ObjectId(courseId),
      quizId: new ObjectId(quizId),
      questionId: new ObjectId(questionId),
      studentId: new ObjectId(studentId),
      reason: "typo",
      status: "pending",
    };
    const collection = {
      updateOne: jest.fn().mockResolvedValue({}),
      findOne: jest.fn().mockResolvedValue(savedFlag),
    };
    databaseService.connect.mockResolvedValue({
      collection: jest.fn(() => collection),
    });

    const result = await flagService.saveStudentFlag({
      courseId,
      quizId,
      questionId,
      studentId,
      reason: "typo",
      comment: "The units in option B are missing.",
      questionText: "Which value has the correct units?",
    });

    expect(result).toBe(savedFlag);
    expect(collection.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        courseId: expect.any(ObjectId),
        quizId: expect.any(ObjectId),
        questionId: expect.any(ObjectId),
        studentId: expect.any(ObjectId),
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          reason: "typo",
          status: "pending",
          reviewedAt: null,
          reviewedBy: null,
        }),
        $setOnInsert: expect.objectContaining({ createdAt: expect.any(Date) }),
      }),
      { upsert: true }
    );
  });
});
