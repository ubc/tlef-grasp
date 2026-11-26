import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const mockPost = jest.fn();
const mockPut = jest.fn();
jest.unstable_mockModule('../../client/src/lib/api.js', () => ({
  api: { post: mockPost, put: mockPut },
}));

const { generateAndSaveObjectives } = await import(
  '../../client/src/pages/question-generation/objectiveGeneration.js'
);

const course = { id: 'course-1', name: 'Biochemistry' };
const granular = { text: 'Define a buffer', bloomTaxonomies: ['Remember'], questionTypes: [] };

// Each objective is saved against the materials it was generated from, not
// every material selected for the run.
describe('generateAndSaveObjectives material links', () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockPost.mockImplementation(async (url, body) => {
      if (url === '/api/rag-llm/generate-learning-objectives') {
        return {
          success: true,
          objectives: [
            { name: 'Explain equilibrium', granularObjectives: [granular], sourceMaterialIds: ['m-1'] },
            { name: 'Relate pKa and pH', granularObjectives: [granular], sourceMaterialIds: ['m-1', 'm-2'] },
            { name: 'Older server reply', granularObjectives: [granular] },
          ],
        };
      }
      return { success: true, objective: { _id: body.name }, granularObjectives: [] };
    });
  });

  it('links each objective to its own source materials', async () => {
    const { saved } = await generateAndSaveObjectives({
      course,
      materialIds: ['m-1', 'm-2'],
      materialTitles: {},
      userObjectives: [],
    });

    const saves = mockPost.mock.calls.filter(([url]) => url === '/api/objective');
    expect(saves.map(([, body]) => body.materialIds)).toEqual([['m-1'], ['m-1', 'm-2'], ['m-1', 'm-2']]);
    expect(saved.map((group) => group.materialIds)).toEqual([['m-1'], ['m-1', 'm-2'], ['m-1', 'm-2']]);
  });
});

// A generated objective whose name matches a saved one brings only its new
// granular objectives, which are added to the saved objective rather than
// saved as a second copy of it.
describe('generateAndSaveObjectives with a repeated objective name', () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockPut.mockReset();
    mockPut.mockResolvedValue({ success: true });
    mockPost.mockImplementation(async (url) => {
      if (url === '/api/rag-llm/generate-learning-objectives') {
        return {
          success: true,
          objectives: [
            {
              name: 'Analyze buffer solutions',
              granularObjectives: [granular],
              sourceMaterialIds: ['m-2'],
              existingObjectiveId: 'lo-1',
              existingMaterialIds: ['m-1'],
            },
          ],
        };
      }
      return {
        success: true,
        objective: { _id: 'lo-1', name: 'Analyze buffer solutions' },
        granularObjectives: [{ _id: 'g-old' }, { _id: 'g-new' }],
      };
    });
  });

  it('adds the granular objectives to the saved objective and links the new material', async () => {
    const { saved } = await generateAndSaveObjectives({
      course,
      materialIds: ['m-1', 'm-2'],
      materialTitles: {},
      userObjectives: [],
    });

    expect(mockPost.mock.calls.map(([url]) => url)).toEqual([
      '/api/rag-llm/generate-learning-objectives',
      '/api/objective/lo-1/granular',
    ]);
    expect(mockPost.mock.calls[1][1].granularObjectives).toEqual([
      { text: 'Define a buffer', bloomTaxonomies: ['Remember'], questionTypes: [] },
    ]);
    expect(mockPut).toHaveBeenCalledWith('/api/objective/lo-1/materials', { materialIds: ['m-1', 'm-2'] });
    expect(saved).toEqual([
      {
        objective: { _id: 'lo-1', name: 'Analyze buffer solutions' },
        granulars: [{ _id: 'g-old' }, { _id: 'g-new' }],
        materialIds: ['m-1', 'm-2'],
      },
    ]);
  });

  it('leaves the links alone when the material is already linked', async () => {
    mockPost.mockImplementationOnce(async () => ({
      success: true,
      objectives: [
        { name: 'Analyze buffer solutions', granularObjectives: [granular], sourceMaterialIds: ['m-1'], existingObjectiveId: 'lo-1', existingMaterialIds: ['m-1'] },
      ],
    }));

    await generateAndSaveObjectives({ course, materialIds: ['m-1'], materialTitles: {}, userObjectives: [] });

    expect(mockPut).not.toHaveBeenCalled();
  });
});
