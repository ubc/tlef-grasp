const { ObjectId } = require('mongodb');

jest.mock('../../src/services/database', () => ({ connect: jest.fn() }));
jest.mock('../../src/services/question', () => ({
  deleteQuestionsByObjectiveIds: jest.fn(),
  orphanQuestionsByObjectiveIds: jest.fn(),
}));
jest.mock('../../src/services/objective-material', () => ({
  updateObjectiveMaterialRelations: jest.fn(),
  getMaterialsForObjective: jest.fn(),
}));

const databaseService = require('../../src/services/database');
const { appendGranularObjectives } = require('../../src/services/objective');

describe('appendGranularObjectives', () => {
  const parentId = new ObjectId();
  const courseId = new ObjectId();
  let collection;

  // A sibling carrying the settings a replace-style update would have cleared.
  const firstLaw = {
    _id: new ObjectId(),
    name: 'Explain the first law',
    parent: parentId,
    courseId,
    bloomTaxonomies: ['Understand'],
    questionTypes: [{ bloomLevel: 'Understand', questionType: 'multiple-choice', count: 4 }],
  };

  // The service reads the parent's children, then re-reads the rows it inserted.
  const stubChildren = (children, inserted = []) =>
    collection.find
      .mockReturnValueOnce({ toArray: jest.fn().mockResolvedValue(children) })
      .mockReturnValue({ toArray: jest.fn().mockResolvedValue(inserted) });

  beforeEach(() => {
    collection = {
      findOne: jest.fn().mockResolvedValue({ _id: parentId, name: 'Thermodynamics', courseId }),
      find: jest.fn(),
      insertMany: jest.fn().mockResolvedValue({ insertedIds: { 0: new ObjectId() } }),
      updateOne: jest.fn(),
      deleteMany: jest.fn(),
    };
    databaseService.connect.mockResolvedValue({ collection: jest.fn(() => collection) });
  });

  it("inserts the new child and leaves the sibling's settings intact", async () => {
    stubChildren([firstLaw]);

    const result = await appendGranularObjectives(parentId.toString(), [{ text: 'Entropy' }]);

    expect(collection.insertMany.mock.calls[0][0]).toEqual([
      expect.objectContaining({ name: 'Entropy', parent: parentId, courseId }),
    ]);
    // The two writes that made a replace-style append lossy.
    expect(collection.updateOne).not.toHaveBeenCalled();
    expect(collection.deleteMany).not.toHaveBeenCalled();

    const kept = result.granular.find((g) => g.name === firstLaw.name);
    expect(kept.bloomTaxonomies).toEqual(['Understand']);
    expect(kept.questionTypes).toEqual(firstLaw.questionTypes);
  });

  it('skips text the parent already has, so a retry adds no second copy', async () => {
    stubChildren([firstLaw]);

    const result = await appendGranularObjectives(parentId.toString(), [
      { text: '  EXPLAIN the First Law ' },
      { text: '' },
    ]);

    expect(collection.insertMany).not.toHaveBeenCalled();
    expect(result.added).toEqual([]);
  });

  it('rejects an unknown parent rather than inserting orphans', async () => {
    collection.findOne.mockResolvedValue(null);

    await expect(
      appendGranularObjectives(new ObjectId().toString(), [{ text: 'Carnot' }])
    ).rejects.toThrow('Objective not found');
    expect(collection.insertMany).not.toHaveBeenCalled();
  });
});
