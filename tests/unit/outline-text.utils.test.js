const {
  batchContent,
  validateOutline,
  renderOutlineBlock,
  truncationNote,
} = require('../../src/utils/outline-text');

const CAPS = { maxTopics: 40, maxKeyPoints: 20, maxChars: 20000 };

describe('batchContent', () => {
  it('returns a single batch when the text fits', () => {
    const result = batchContent('short text', { batchChars: 100, maxBatches: 8 });
    expect(result.batches).toEqual(['short text']);
    expect(result.truncated).toBe(false);
    expect(result.coveredChars).toBe('short text'.length);
    expect(result.totalChars).toBe('short text'.length);
  });

  it('splits plain text without page markers at the batch size', () => {
    const result = batchContent('a'.repeat(250), { batchChars: 100, maxBatches: 8 });
    expect(result.batches).toHaveLength(3);
    expect(result.batches[0]).toHaveLength(100);
    expect(result.batches[2]).toHaveLength(50);
    expect(result.truncated).toBe(false);
  });

  // The PDF parser writes "Page N:" markers; a batch should not straddle one
  // when it can be avoided.
  it('prefers page-marker boundaries', () => {
    const text = `Page 1:\n${'a'.repeat(60)}\n\nPage 2:\n${'b'.repeat(60)}\n\nPage 3:\n${'c'.repeat(60)}`;
    const result = batchContent(text, { batchChars: 140, maxBatches: 8 });

    expect(result.batches.length).toBeGreaterThan(1);
    result.batches.forEach((batch) => {
      // Every batch starts at a page marker rather than mid-page.
      expect(batch.startsWith('Page ')).toBe(true);
    });
    expect(result.batches.join('')).toContain('c'.repeat(60));
  });

  it('hard-splits a single page larger than the batch size', () => {
    const text = `Page 1:\n${'a'.repeat(300)}`;
    const result = batchContent(text, { batchChars: 100, maxBatches: 8 });
    expect(result.batches.length).toBeGreaterThan(1);
    expect(result.truncated).toBe(false);
  });

  it('caps the batch count and reports truncation', () => {
    const result = batchContent('a'.repeat(1000), { batchChars: 100, maxBatches: 3 });
    expect(result.batches).toHaveLength(3);
    expect(result.truncated).toBe(true);
    expect(result.coveredChars).toBe(300);
    expect(result.totalChars).toBe(1000);
  });

  it('returns no batches for empty text', () => {
    expect(batchContent('', { batchChars: 100, maxBatches: 8 }).batches).toEqual([]);
    expect(batchContent('   ', { batchChars: 100, maxBatches: 8 }).batches).toEqual([]);
  });
});

describe('validateOutline', () => {
  const valid = {
    topics: [{ title: 'Cell respiration', keyPoints: ['ATP is produced', 'Occurs in mitochondria'] }],
    notes: '',
  };

  it('accepts a well-formed outline and trims whitespace', () => {
    const result = validateOutline(
      { topics: [{ title: '  Trimmed  ', keyPoints: ['  point  '] }], notes: 'n' },
      CAPS
    );
    expect(result.ok).toBe(true);
    expect(result.outline.topics[0].title).toBe('Trimmed');
    expect(result.outline.topics[0].keyPoints).toEqual(['point']);
  });

  it('accepts a topic with no key points', () => {
    expect(validateOutline({ topics: [{ title: 'T', keyPoints: [] }], notes: '' }, CAPS).ok).toBe(true);
  });

  it.each([
    ['not an object', null],
    ['missing topics', { notes: '' }],
    ['topics not an array', { topics: 'x', notes: '' }],
    ['zero topics', { topics: [], notes: '' }],
    ['blank title', { topics: [{ title: '   ', keyPoints: [] }], notes: '' }],
    ['non-string title', { topics: [{ title: 5, keyPoints: [] }], notes: '' }],
    ['keyPoints not an array', { topics: [{ title: 'T', keyPoints: 'x' }], notes: '' }],
    ['blank key point', { topics: [{ title: 'T', keyPoints: ['  '] }], notes: '' }],
  ])('rejects %s', (_label, outline) => {
    const result = validateOutline(outline, CAPS);
    expect(result.ok).toBe(false);
    expect(typeof result.error).toBe('string');
    expect(result.error.length).toBeGreaterThan(0);
  });

  it('rejects too many topics', () => {
    const topics = Array.from({ length: 5 }, (_, i) => ({ title: `T${i}`, keyPoints: [] }));
    expect(validateOutline({ topics, notes: '' }, { ...CAPS, maxTopics: 4 }).ok).toBe(false);
  });

  it('rejects too many key points in one topic', () => {
    const keyPoints = Array.from({ length: 5 }, (_, i) => `p${i}`);
    expect(
      validateOutline({ topics: [{ title: 'T', keyPoints }], notes: '' }, { ...CAPS, maxKeyPoints: 4 }).ok
    ).toBe(false);
  });

  it('rejects an outline over the total character cap', () => {
    const outline = { topics: [{ title: 'T', keyPoints: ['x'.repeat(200)] }], notes: '' };
    expect(validateOutline(outline, { ...CAPS, maxChars: 100 }).ok).toBe(false);
    expect(validateOutline(valid, CAPS).ok).toBe(true);
  });
});

describe('renderOutlineBlock', () => {
  const outline = {
    topics: [
      { title: 'Topic A', keyPoints: ['Point one', 'Point two'] },
      { title: 'Topic B', keyPoints: ['Point three'] },
    ],
    notes: '',
  };

  it('renders the material header and topic structure', () => {
    const block = renderOutlineBlock({
      documentTitle: 'Lecture 3',
      sourceId: 'src-1',
      outline,
    });

    expect(block).toContain('### MATERIAL: Lecture 3 (SOURCE ID: src-1)');
    expect(block).toContain('## Topic A');
    expect(block).toContain('- Point one');
    expect(block).toContain('## Topic B');
    expect(block).not.toContain('NOTES:');
  });

  it('includes notes only when present', () => {
    const block = renderOutlineBlock({
      documentTitle: 'Lecture 3',
      sourceId: 'src-1',
      outline: { ...outline, notes: 'Scanned pages.' },
    });
    expect(block).toContain('NOTES: Scanned pages.');
  });

  it('falls back to a placeholder title when none is stored', () => {
    const block = renderOutlineBlock({ documentTitle: '', sourceId: 'src-1', outline });
    expect(block).toContain('### MATERIAL: Untitled material (SOURCE ID: src-1)');
  });
});

describe('truncationNote', () => {
  it('states how much of the material was covered', () => {
    const note = truncationNote(640000, 1500000);
    expect(note).toContain('640000');
    expect(note).toContain('1500000');
  });
});
