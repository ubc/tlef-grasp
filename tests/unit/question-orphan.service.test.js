const { ObjectId } = require('mongodb');

jest.mock('../../src/services/database', () => ({
  connect: jest.fn(),
}));
jest.mock('../../src/services/objective-material', () => ({
  updateObjectiveMaterialRelations: jest.fn().mockResolvedValue(true),
}));

const databaseService = require('../../src/services/database');
const questionService = require('../../src/services/question');
const objectiveService = require('../../src/services/objective');
const quizService = require('../../src/services/quiz');

// Issue #61: deleting a learning objective (or pruning granular objectives
// during an edit) used to leave generated questions pointing at objectives
// that no longer exist. Those questions produced attempts with a null LO,
// which collided on the unique mastery index during AI-grade review.

describe('orphanQuestionsByObjectiveIds', () => {
  let questionCollection;
  let quizQuestionCollection;

  beforeEach(() => {
    questionCollection = {
      find: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ modifiedCount: 2 }),
    };
    quizQuestionCollection = {
      deleteMany: jest.fn().mockResolvedValue({ deletedCount: 3 }),
    };
    databaseService.connect.mockResolvedValue({
      collection: jest.fn((name) => {
        if (name === 'grasp_question') return questionCollection;
        if (name === 'grasp_quiz_question') return quizQuestionCollection;
        throw new Error(`Unexpected collection: ${name}`);
      }),
    });
  });

  it('flags referencing questions and removes them from all quizzes', async () => {
    const granularId = new ObjectId();
    const q1 = new ObjectId();
    const q2 = new ObjectId();
    questionCollection.find.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([{ _id: q1 }, { _id: q2 }]),
    });

    const result = await questionService.orphanQuestionsByObjectiveIds([granularId]);

    expect(questionCollection.updateMany).toHaveBeenCalledWith(
      { _id: { $in: [q1, q2] } },
      { $set: expect.objectContaining({ orphaned: true, orphanedAt: expect.any(Date) }) }
    );
    expect(quizQuestionCollection.deleteMany).toHaveBeenCalledWith({
      questionId: { $in: [q1, q2] },
    });
    expect(result).toEqual({ orphanedCount: 2, removedFromQuizzes: 3 });
  });

  it('does nothing when no questions reference the deleted objectives', async () => {
    questionCollection.find.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([]),
    });

    const result = await questionService.orphanQuestionsByObjectiveIds([new ObjectId()]);

    expect(questionCollection.updateMany).not.toHaveBeenCalled();
    expect(quizQuestionCollection.deleteMany).not.toHaveBeenCalled();
    expect(result).toEqual({ orphanedCount: 0, removedFromQuizzes: 0 });
  });

  it('does nothing for an empty id list without touching the database', async () => {
    const result = await questionService.orphanQuestionsByObjectiveIds([]);

    expect(databaseService.connect).not.toHaveBeenCalled();
    expect(result).toEqual({ orphanedCount: 0, removedFromQuizzes: 0 });
  });
});

describe('deleteObjective orphaning', () => {
  it('orphans questions for the deleted parent and all its granular objectives', async () => {
    const parentId = new ObjectId();
    const g1 = new ObjectId();
    const g2 = new ObjectId();
    const objectiveCollection = {
      find: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([{ _id: g1 }, { _id: g2 }]),
      }),
      deleteMany: jest.fn().mockResolvedValue({ deletedCount: 2 }),
      deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    };
    databaseService.connect.mockResolvedValue({
      collection: jest.fn(() => objectiveCollection),
    });
    const orphanSpy = jest
      .spyOn(questionService, 'orphanQuestionsByObjectiveIds')
      .mockResolvedValue({ orphanedCount: 2, removedFromQuizzes: 2 });

    await objectiveService.deleteObjective(parentId.toString());

    expect(orphanSpy).toHaveBeenCalledWith([g1, g2, parentId]);
    orphanSpy.mockRestore();
  });
});

describe('addQuestionsToQuiz orphan guard', () => {
  it('refuses to attach orphaned questions to a quiz', async () => {
    const quizId = new ObjectId();
    const orphanedId = new ObjectId();
    const okId = new ObjectId();
    const questionCollection = {
      find: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([{ _id: orphanedId }]),
      }),
    };
    const quizQuestionCollection = {
      insertMany: jest.fn().mockResolvedValue({ insertedCount: 1 }),
    };
    databaseService.connect.mockResolvedValue({
      collection: jest.fn((name) => {
        if (name === 'grasp_question') return questionCollection;
        if (name === 'grasp_quiz_question') return quizQuestionCollection;
        throw new Error(`Unexpected collection: ${name}`);
      }),
    });

    await quizService.addQuestionsToQuiz(quizId.toString(), [
      orphanedId.toString(),
      okId.toString(),
    ]);

    expect(questionCollection.find).toHaveBeenCalledWith(
      { _id: { $in: [orphanedId, okId] }, orphaned: true },
      { projection: { _id: 1 } }
    );
    const inserted = quizQuestionCollection.insertMany.mock.calls[0][0];
    expect(inserted).toHaveLength(1);
    expect(String(inserted[0].questionId)).toBe(okId.toString());
  });
});
