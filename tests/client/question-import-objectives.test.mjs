import { describe, it, expect } from '@jest/globals';
import {
  bucketImportedObjectives,
  creatableKeys,
  planObjectiveCreations,
  isRowResolved,
  matchGranular,
} from '../../client/src/lib/questionImport.js';

// `owned` is a course granular as flattenGranulars produces it; `fromFile` is one
// meta of an export's `objectives` array as buildObjectivesSummary writes it.
const owned = (id, name, metaId = 'm1', metaName = 'Thermodynamics') => ({ id, name, metaId, metaName });
const fromFile = (metaObjectiveName, names) => ({
  metaObjectiveName,
  granularObjectives: names.map((name, i) => ({ id: `fg-${i}`, name })),
});
const FIRST_LAW = owned('g1', 'Explain the first law');
const bucket = (file, course = []) => bucketImportedObjectives(file, course);

describe('bucketImportedObjectives', () => {
  it('matches owned text ignoring case and space, exactly as matchGranular does', () => {
    const messy = '  EXPLAIN the First Law ';
    const [group] = bucket([fromFile('Thermodynamics', [messy])], [FIRST_LAW]);
    expect(group.granulars[0].existingId).toBe('g1');
    expect(creatableKeys([group])).toEqual([]);
    expect(matchGranular({ granularObjectiveName: messy }, [FIRST_LAW])).toBe('g1');
  });

  it('offers unowned text for creation, resolving its meta by name', () => {
    const [group] = bucket([fromFile('thermodynamics', ['Calculate entropy change'])], [FIRST_LAW]);
    expect(group.granulars[0].existingId).toBeNull();
    expect(group.existingMetaId).toBe('m1');
    expect(group.existingGranulars.map((g) => g.id)).toEqual(['g1']);
    expect(creatableKeys([group])).toEqual(['calculate entropy change']);
  });

  it('emits repeated text once across metas', () => {
    const groups = bucket([
      fromFile('Thermo', ['Explain the first law']),
      fromFile('Advanced', ['Explain the first law', 'Carnot']),
    ]);
    expect(creatableKeys(groups)).toEqual(['explain the first law', 'carnot']);
  });

  it('never offers text owned under a different meta', () => {
    const [group] = bucket([fromFile('Advanced Thermo', ['Explain the first law'])], [FIRST_LAW]);
    expect(group.existingMetaId).toBeNull();
    expect(group.granulars[0].existingId).toBe('g1');
    expect(creatableKeys([group])).toEqual([]);
  });

  it('drops blank granulars, tolerates missing input, labels an unnamed meta', () => {
    expect(bucket([fromFile('Empty', ['', '  '])])).toEqual([]);
    expect(bucket([{ metaObjectiveName: 'X' }])).toEqual([]);
    expect(bucketImportedObjectives(null, null)).toEqual([]);
    expect(bucket([fromFile('', ['Orphan'])])[0].metaName).toBe('Ungrouped objectives');
  });
});

describe('planObjectiveCreations', () => {
  it('POSTs a new meta with only its checked children', () => {
    const groups = bucket([fromFile('Advanced', ['Carnot', 'Maxwell'])]);
    expect(planObjectiveCreations(groups, new Set(['carnot']))).toEqual({
      creates: [{ name: 'Advanced', granularObjectives: [{ text: 'Carnot' }] }],
      appends: [],
    });
  });

  it('PUTs an owned meta with its current children resent alongside the new one', () => {
    const groups = bucket([fromFile('Thermodynamics', ['Calculate entropy change'])], [FIRST_LAW]);
    expect(planObjectiveCreations(groups, new Set(['calculate entropy change']))).toEqual({
      creates: [],
      appends: [
        {
          objectiveId: 'm1',
          metaName: 'Thermodynamics',
          granularObjectives: [
            { _id: 'g1', text: 'Explain the first law' },
            { text: 'Calculate entropy change' },
          ],
        },
      ],
    });
  });

  it('plans nothing when unchecked, and accepts an array as well as a Set', () => {
    const groups = bucket([fromFile('Advanced', ['Carnot'])]);
    expect(planObjectiveCreations(groups, new Set())).toEqual({ creates: [], appends: [] });
    expect(planObjectiveCreations(groups, ['carnot']).creates).toHaveLength(1);
  });
});

it('isRowResolved settles on an existing match or a checked box, not on neither', () => {
  const question = { granularObjectiveName: 'Carnot' };
  expect(isRowResolved({ question, granularId: 'g9' }, new Set())).toBe(true);
  expect(isRowResolved({ question, granularId: '' }, new Set(['carnot']))).toBe(true);
  expect(isRowResolved({ question, granularId: '' }, new Set())).toBe(false);
  expect(isRowResolved({ question: {}, granularId: '' }, new Set(['carnot']))).toBe(false);
});

// Covers the objective half of a re-import; the question half is deduped
// server-side (tests/unit/question-import-dedupe.service.test.js). Holds only while
// the granular survives between imports: deleting it leaves the questions with a
// dangling granularObjectiveId, and the re-import creates a new granular that
// dedupe cannot match. Tracked separately.
it('re-importing the same file creates nothing and rebinds by name', () => {
  const file = [fromFile('Thermodynamics', ['Explain the first law', 'Calculate entropy change'])];
  const afterFirstPass = [FIRST_LAW, owned('g2', 'Calculate entropy change')];

  expect(creatableKeys(bucket(file))).toHaveLength(2);
  const second = bucket(file, afterFirstPass);
  expect(creatableKeys(second)).toEqual([]);
  expect(planObjectiveCreations(second, new Set())).toEqual({ creates: [], appends: [] });

  // The file carries the source course's ids, so the name branch is what binds.
  const question = {
    granularObjectiveId: 'an-id-from-the-source-course',
    granularObjectiveName: 'Explain the first law',
  };
  expect(matchGranular(question, afterFirstPass)).toBe('g1');
});
