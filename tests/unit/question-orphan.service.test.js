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
      // Kept questions are forced back to Draft so an orphan can't stay Approved.
      { $set: expect.objectContaining({ orphaned: true, orphanedAt: expect.any(Date), status: 'Draft' }) }
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

// Issue #82: on deletion, instructors must explicitly choose whether linked
// questions are kept (orphaned as Draft) or deleted outright.

describe('deleteQuestionsByObjectiveIds', () => {
  it('hard-deletes referencing questions and their quiz mappings', async () => {
    const granularId = new ObjectId();
    const q1 = new ObjectId();
    const q2 = new ObjectId();
    const questionCollection = {
      find: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([{ _id: q1 }, { _id: q2 }]),
      }),
      deleteMany: jest.fn().mockResolvedValue({ deletedCount: 2 }),
    };
    const quizQuestionCollection = {
      deleteMany: jest.fn().mockResolvedValue({ deletedCount: 4 }),
    };
    databaseService.connect.mockResolvedValue({
      collection: jest.fn((name) => {
        if (name === 'grasp_question') return questionCollection;
        if (name === 'grasp_quiz_question') return quizQuestionCollection;
        throw new Error(`Unexpected collection: ${name}`);
      }),
    });

    const result = await questionService.deleteQuestionsByObjectiveIds([granularId]);

    expect(questionCollection.deleteMany).toHaveBeenCalledWith({ _id: { $in: [q1, q2] } });
    expect(quizQuestionCollection.deleteMany).toHaveBeenCalledWith({ questionId: { $in: [q1, q2] } });
    expect(result).toEqual({ deletedCount: 2, removedFromQuizzes: 4 });
  });

  it('does nothing for an empty id list', async () => {
    const result = await questionService.deleteQuestionsByObjectiveIds([]);
    expect(databaseService.connect).not.toHaveBeenCalled();
    expect(result).toEqual({ deletedCount: 0, removedFromQuizzes: 0 });
  });
});

describe('getLinkedQuestionsSummary', () => {
  it('counts live questions, approved ones, quiz usage and affected quiz names', async () => {
    const granularId = new ObjectId();
    const q1 = new ObjectId();
    const q2 = new ObjectId();
    const quizId = new ObjectId();
    const questionCollection = {
      find: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([
          { _id: q1, status: 'Approved' },
          { _id: q2, status: 'Draft' },
        ]),
      }),
    };
    const quizQuestionCollection = {
      find: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([{ questionId: q1, quizId }]),
      }),
    };
    const quizCollection = {
      find: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([{ _id: quizId, name: 'Midterm' }]),
      }),
    };
    databaseService.connect.mockResolvedValue({
      collection: jest.fn((name) => {
        if (name === 'grasp_question') return questionCollection;
        if (name === 'grasp_quiz_question') return quizQuestionCollection;
        if (name === 'grasp_quiz') return quizCollection;
        throw new Error(`Unexpected collection: ${name}`);
      }),
    });

    const result = await questionService.getLinkedQuestionsSummary([granularId]);

    expect(result).toEqual({
      questionCount: 2,
      approvedCount: 1,
      inQuizCount: 1,
      quizNames: ['Midterm'],
    });
  });

  it('returns an empty summary for an empty id list', async () => {
    const result = await questionService.getLinkedQuestionsSummary([]);
    expect(databaseService.connect).not.toHaveBeenCalled();
    expect(result).toEqual({ questionCount: 0, approvedCount: 0, inQuizCount: 0, quizNames: [] });
  });
});

describe('updateQuestion orphan rules', () => {
  it('blocks approving an orphaned question', async () => {
    const questionId = new ObjectId();
    const questionCollection = {
      findOne: jest.fn().mockResolvedValue({ orphaned: true }),
      updateOne: jest.fn(),
    };
    databaseService.connect.mockResolvedValue({
      collection: jest.fn((name) => {
        if (name === 'grasp_question') return questionCollection;
        throw new Error(`Unexpected collection: ${name}`);
      }),
    });

    await expect(
      questionService.updateQuestion(questionId.toString(), { status: 'Approved' })
    ).rejects.toMatchObject({ code: 'ORPHANED_APPROVAL_BLOCKED' });
    expect(questionCollection.updateOne).not.toHaveBeenCalled();
  });

  it('clears the orphaned state when a new objective is attached', async () => {
    const questionId = new ObjectId();
    const granularId = new ObjectId();
    const parentId = new ObjectId();
    const questionCollection = {
      findOne: jest.fn(),
      updateOne: jest.fn().mockResolvedValue({ acknowledged: true, modifiedCount: 1 }),
    };
    const objectiveCollection = {
      findOne: jest.fn().mockResolvedValue({ parent: parentId }),
    };
    databaseService.connect.mockResolvedValue({
      collection: jest.fn((name) => {
        if (name === 'grasp_question') return questionCollection;
        if (name === 'grasp_objective') return objectiveCollection;
        throw new Error(`Unexpected collection: ${name}`);
      }),
    });

    await questionService.updateQuestion(questionId.toString(), {
      granularObjectiveId: granularId.toString(),
    });

    expect(questionCollection.updateOne).toHaveBeenCalledWith(
      { _id: questionId },
      { $set: expect.objectContaining({ orphaned: false, orphanedAt: null, learningObjectiveId: parentId }) }
    );
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

  it('hard-deletes linked questions when questionAction is "delete"', async () => {
    const parentId = new ObjectId();
    const g1 = new ObjectId();
    const objectiveCollection = {
      find: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([{ _id: g1 }]),
      }),
      deleteMany: jest.fn().mockResolvedValue({ deletedCount: 1 }),
      deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    };
    databaseService.connect.mockResolvedValue({
      collection: jest.fn(() => objectiveCollection),
    });
    const deleteSpy = jest
      .spyOn(questionService, 'deleteQuestionsByObjectiveIds')
      .mockResolvedValue({ deletedCount: 3, removedFromQuizzes: 3 });
    const orphanSpy = jest
      .spyOn(questionService, 'orphanQuestionsByObjectiveIds')
      .mockResolvedValue({ orphanedCount: 0, removedFromQuizzes: 0 });

    await objectiveService.deleteObjective(parentId.toString(), 'delete');

    expect(deleteSpy).toHaveBeenCalledWith([g1, parentId]);
    expect(orphanSpy).not.toHaveBeenCalled();
    deleteSpy.mockRestore();
    orphanSpy.mockRestore();
  });
});

describe('updateObjective granular diff (issue #82 regression)', () => {
  it('only orphans questions for granulars actually removed, even when the client sends _id', async () => {
    const parentId = new ObjectId();
    const g1 = new ObjectId();
    const g2 = new ObjectId();
    const g3 = new ObjectId();
    const existingGranular = [
      { _id: g1, parent: parentId },
      { _id: g2, parent: parentId },
      { _id: g3, parent: parentId },
    ];
    const objectiveCollection = {
      findOne: jest.fn().mockResolvedValue({ _id: parentId, courseId: new ObjectId() }),
      find: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue(existingGranular),
      }),
      updateOne: jest.fn().mockResolvedValue({}),
      insertMany: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    };
    databaseService.connect.mockResolvedValue({
      collection: jest.fn(() => objectiveCollection),
    });
    const orphanSpy = jest
      .spyOn(questionService, 'orphanQuestionsByObjectiveIds')
      .mockResolvedValue({ orphanedCount: 0, removedFromQuizzes: 0 });

    // Client keeps g1 & g2 (identified only by _id) and drops g3.
    await objectiveService.updateObjective(parentId.toString(), {
      granularObjectives: [
        { _id: g1.toString(), name: 'a' },
        { _id: g2.toString(), name: 'b' },
      ],
    });

    // Only g3 should be deleted / orphaned — not the kept granulars.
    expect(objectiveCollection.deleteMany).toHaveBeenCalledWith({
      _id: { $in: [g3] },
      parent: parentId,
    });
    expect(orphanSpy).toHaveBeenCalledWith([g3]);
    expect(objectiveCollection.insertMany).not.toHaveBeenCalled();
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
