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

describe("getCourseFlags student names", () => {
  // A cursor stub for find().sort().toArray() and find().project().toArray().
  const cursor = (rows) => {
    const chain = {
      sort: () => chain,
      project: () => chain,
      toArray: () => Promise.resolve(rows),
    };
    return chain;
  };

  it("names a student by legal name, else by the name Canvas gave them (issue #165)", async () => {
    const quizId = new ObjectId();
    const questionId = new ObjectId();
    const signedIn = new ObjectId();
    const synced = new ObjectId();
    const flag = (studentId) => ({
      _id: new ObjectId(),
      quizId,
      questionId,
      studentId,
      status: "pending",
    });
    const rowsByCollection = {
      grasp_quiz_question_flag: [flag(signedIn), flag(synced)],
      grasp_quiz: [{ _id: quizId, name: "Quiz 1" }],
      grasp_question: [{ _id: questionId, status: "Approved" }],
      grasp_user: [
        { _id: signedIn, legalName: "Bruno Student", displayName: "Bruno", email: "b@ubc.ca" },
        // Created by the Canvas roster sync and never signed in: no legal
        // name or email, only the Canvas name.
        { _id: synced, displayName: "Casey Canvasonly", email: null, puid: "99990001" },
      ],
    };
    databaseService.connect.mockResolvedValue({
      collection: jest.fn((name) => ({ find: () => cursor(rowsByCollection[name]) })),
    });

    const flags = await flagService.getCourseFlags(new ObjectId().toString());

    expect(flags.map((each) => each.studentName)).toEqual(["Bruno Student", "Casey Canvasonly"]);
  });
});
