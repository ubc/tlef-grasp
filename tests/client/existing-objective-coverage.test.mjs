import { describe, expect, it } from '@jest/globals';
import { existingObjectiveCoverage } from '../../client/src/pages/question-generation/existingObjectiveCoverage.js';

const objective = (id, materialIds) => ({ id, name: `Objective ${id}`, materialIds, granular: [] });

// "Use existing" is only a complete answer when every selected material
// already has objectives; a material with none still needs generating.
describe('existingObjectiveCoverage', () => {
  const objectives = [objective('lo-1', ['m-1']), objective('lo-2', ['m-1', 'm-3']), objective('lo-3', ['m-9'])];

  it('reports nothing existing when no selected material has objectives', () => {
    expect(existingObjectiveCoverage(objectives, ['m-2'])).toEqual({
      existing: [],
      uncoveredMaterialIds: ['m-2'],
      fullyCovered: false,
    });
  });

  it('is not fully covered when one selected material has none', () => {
    const coverage = existingObjectiveCoverage(objectives, ['m-1', 'm-2']);
    expect(coverage.existing.map((o) => o.id)).toEqual(['lo-1', 'lo-2']);
    expect(coverage.uncoveredMaterialIds).toEqual(['m-2']);
    expect(coverage.fullyCovered).toBe(false);
  });

  it('is fully covered when every selected material has objectives', () => {
    const coverage = existingObjectiveCoverage(objectives, ['m-1', 'm-3']);
    expect(coverage.existing.map((o) => o.id)).toEqual(['lo-1', 'lo-2']);
    expect(coverage.uncoveredMaterialIds).toEqual([]);
    expect(coverage.fullyCovered).toBe(true);
  });

  it('is not covered with nothing selected', () => {
    expect(existingObjectiveCoverage(objectives, []).fullyCovered).toBe(false);
  });
});
