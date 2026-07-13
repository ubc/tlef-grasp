const { ObjectId } = require('mongodb');

jest.mock('../../src/services/database', () => ({
  connect: jest.fn(),
}));

const databaseService = require('../../src/services/database');
const questionService = require('../../src/services/question');

describe('question objective links', () => {
  let questionCollection;
  let objectiveCollection;

  beforeEach(() => {
    questionCollection = {
      insertOne: jest.fn().mockResolvedValue({ insertedId: new ObjectId() }),
      findOne: jest.fn(),
    };
    objectiveCollection = {
      findOne: jest.fn(),
    };
    databaseService.connect.mockResolvedValue({
      collection: jest.fn((name) => {
        if (name === 'grasp_question') return questionCollection;
        if (name === 'grasp_objective') return objectiveCollection;
        throw new Error(`Unexpected collection: ${name}`);
      }),
    });
  });

  it('derives and stores the parent learning objective from the granular objective', async () => {
    const courseId = new ObjectId();
    const parentId = new ObjectId();
    const granularId = new ObjectId();
    objectiveCollection.findOne.mockResolvedValue({ _id: granularId, parent: parentId });

    await questionService.saveQuestion(courseId.toString(), {
      title: 'Generated question',
      stem: 'Explain the concept.',
      questionType: 'open-ended',
      granularObjectiveId: granularId.toString(),
    });

    expect(objectiveCollection.findOne).toHaveBeenCalledWith(
      { _id: granularId, courseId },
      { projection: { parent: 1 } }
    );
    expect(questionCollection.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        courseId,
        learningObjectiveId: parentId,
        granularObjectiveId: granularId,
      })
    );
  });

  it('enriches a legacy single-question read when the stored parent ID is missing', async () => {
    const questionId = new ObjectId();
    const parentId = new ObjectId();
    const granularId = new ObjectId();
    questionCollection.findOne.mockResolvedValue({
      _id: questionId,
      learningObjectiveId: null,
      granularObjectiveId: granularId,
    });
    objectiveCollection.findOne.mockResolvedValue({ _id: granularId, parent: parentId });

    await expect(questionService.getQuestion(questionId.toString())).resolves.toEqual(
      expect.objectContaining({ learningObjectiveId: parentId })
    );
  });
});
