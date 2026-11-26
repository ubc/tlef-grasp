import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const mockPost = jest.fn();
jest.unstable_mockModule('../../client/src/lib/api.js', () => ({
  api: { post: mockPost },
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
