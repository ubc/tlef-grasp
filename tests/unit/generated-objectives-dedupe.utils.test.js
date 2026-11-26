// The safety net behind "generate only adds": exact repeats of saved
// objectives (ignoring case, punctuation and spacing) are dropped, rewordings
// are left to the prompt.
const {
  dropExistingObjectives,
  existingObjectivesPromptBlock,
  normalizeObjectiveText,
} = require('../../src/utils/generated-objectives');

const generated = (name, ...texts) => ({
  name,
  granularObjectives: texts.map((text) => ({ text, bloomTaxonomies: ['Understand'], questionTypes: [] })),
});
const saved = (name, ...texts) => ({ name, granularObjectives: texts.map((text) => ({ name: text })) });

describe('normalizeObjectiveText', () => {
  it('ignores case, punctuation and spacing, but keeps letters in any language', () => {
    expect(normalizeObjectiveText('  Explain: the Krebs-cycle!! ')).toBe('explain the krebs cycle');
    expect(normalizeObjectiveText('Décrire la mitose')).toBe('décrire la mitose');
    expect(normalizeObjectiveText(undefined)).toBe('');
  });
});

describe('dropExistingObjectives', () => {
  it('keeps everything when nothing is saved', () => {
    const objectives = [generated('A', 'a1')];
    expect(dropExistingObjectives(objectives, [])).toEqual(objectives);
  });

  // A repeated name used to drop the whole objective, new granular objectives
  // and all. They now go under the saved objective instead.
  it('adds the new granular objectives of a repeated name to the saved objective', () => {
    const existing = { ...saved('explain the krebs cycle', 'Name the steps'), _id: 'lo-1', materialSourceIds: ['m-1'] };
    const result = dropExistingObjectives(
      [generated('Explain the Krebs cycle.', 'name the steps', 'Trace the carbons')],
      [existing]
    );
    expect(result).toEqual([
      {
        ...generated('explain the krebs cycle', 'Trace the carbons'),
        existingObjectiveId: 'lo-1',
        existingMaterialIds: ['m-1'],
      },
    ]);
  });

  it('drops a repeated name that brings no new granular objectives', () => {
    const result = dropExistingObjectives([generated('Explain the Krebs cycle.', 'x')], [saved('explain the krebs cycle', 'x')]);
    expect(result).toEqual([]);
  });

  it('drops repeated granular objectives and any objective left with none', () => {
    const result = dropExistingObjectives(
      [generated('New topic', 'Old point', 'New point'), generated('Only old', 'Old point')],
      [saved('Something else', 'old point')]
    );
    expect(result).toEqual([generated('New topic', 'New point')]);
  });

  it('never treats a blank saved objective as matching', () => {
    const result = dropExistingObjectives([generated('Topic', 'Point')], [saved('', '')]);
    expect(result).toEqual([generated('Topic', 'Point')]);
  });
});

describe('existingObjectivesPromptBlock', () => {
  it('is empty when there are no saved objectives', () => {
    expect(existingObjectivesPromptBlock([])).toBe('');
    expect(existingObjectivesPromptBlock(undefined)).toBe('');
  });

  it('lists each saved objective with its granular objectives', () => {
    const block = existingObjectivesPromptBlock([saved('Explain A', 'a1', 'a2'), saved('Explain B')]);
    expect(block).toContain('1. Explain A\n   - a1\n   - a2');
    expect(block).toContain('2. Explain B');
    expect(block).toContain('return an empty objectives array');
  });
});
