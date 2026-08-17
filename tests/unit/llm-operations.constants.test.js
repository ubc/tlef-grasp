const fs = require('fs');
const path = require('path');

const {
  OPERATION_GROUPS,
  groupForOperation,
} = require('../../src/constants/llm-operations');

describe('groupForOperation', () => {
  it('groups the pipeline stages an instructor action maps to', () => {
    expect(groupForOperation('pdf-page-image')).toBe('document-parsing');
    expect(groupForOperation('pptx-slide-image')).toBe('document-parsing');
    expect(groupForOperation('outline-batch')).toBe('outline-generation');
    expect(groupForOperation('outline-consolidate')).toBe('outline-generation');
    expect(groupForOperation('objective-generate')).toBe('objective-generation');
    expect(groupForOperation('question-plan')).toBe('question-generation');
    expect(groupForOperation('question-generate')).toBe('question-generation');
    expect(groupForOperation('question-review')).toBe('question-review-fix');
    expect(groupForOperation('question-fix')).toBe('question-review-fix');
    expect(groupForOperation('grade-open-ended')).toBe('answer-grading');
    expect(groupForOperation('grade-fill-in-the-blank')).toBe('answer-grading');
  });

  it('buckets anything unmapped rather than dropping it', () => {
    expect(groupForOperation('something-added-later')).toBe('other');
    expect(groupForOperation(undefined)).toBe('other');
  });

  it('orders groups along the pipeline so a report reads in the order work happens', () => {
    expect(Object.keys(OPERATION_GROUPS)).toEqual([
      'document-parsing',
      'outline-generation',
      'objective-generation',
      'question-generation',
      'question-review-fix',
      'answer-grading',
    ]);
  });
});

// Structural guard: a new call site with a new label would otherwise land in
// "other" silently, and the group totals would quietly stop describing the
// pipeline. Failing here is the prompt to decide which group it belongs to.
describe('coverage of the operation labels used in src/', () => {
  const collectLabels = (dir, found = new Set()) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) collectLabels(full, found);
      else if (entry.name.endsWith('.js')) {
        const source = fs.readFileSync(full, 'utf8');
        for (const match of source.matchAll(/operation: *['"]([a-z-]+)['"]/g)) {
          found.add(match[1]);
        }
      }
    }
    return found;
  };

  it('maps every operation label that exists in the codebase', () => {
    const labels = [...collectLabels(path.join(__dirname, '..', '..', 'src'))];

    expect(labels.length).toBeGreaterThan(0);
    const ungrouped = labels.filter((label) => groupForOperation(label) === 'other');
    expect(ungrouped).toEqual([]);
  });
});
