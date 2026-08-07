const {
  computeQuotas,
  mergePerMaterialChunks,
  retrieveChunksPerMaterial,
  formatChunksByMaterial,
} = require('../../src/services/rag-fanout');

/** One chunk from `sourceId` with the given similarity score. */
const chunk = (sourceId, score) => ({
  content: `${sourceId} content @ ${score}`,
  score,
  metadata: { sourceId, documentTitle: `Title ${sourceId}` },
});

/** `count` chunks from `sourceId`, descending in score from `topScore`. */
const chunksFrom = (sourceId, count, topScore = 0.9) =>
  Array.from({ length: count }, (_, i) =>
    chunk(sourceId, Number((topScore - i * 0.0001).toFixed(4)))
  );

/**
 * Stand-in for a RAG instance. Records every search so tests can assert how
 * many were issued and with what limit.
 */
const fakeInstance = (bySource, { failFor = [], emptyWithThreshold = [] } = {}) => {
  const searches = [];
  return {
    searches,
    retrieveContext: jest.fn(async (query, { limit, scoreThreshold, filter }) => {
      const sourceId = filter.must[0].match.any[0];
      searches.push({ sourceId, limit, scoreThreshold });
      if (failFor.includes(sourceId)) {
        throw new Error(`qdrant unavailable for ${sourceId}`);
      }
      if (emptyWithThreshold.includes(sourceId) && scoreThreshold !== undefined) {
        return [];
      }
      return (bySource[sourceId] || []).slice(0, limit);
    }),
  };
};

const sourceIdsOf = (chunks) => chunks.map((c) => c.metadata.sourceId);

describe('computeQuotas', () => {
  it('splits the budget so quotas sum to exactly the total', () => {
    expect(computeQuotas(200, 3)).toEqual([67, 67, 66]);
    expect(computeQuotas(50, 3)).toEqual([17, 17, 16]);
    expect(computeQuotas(50, 2)).toEqual([25, 25]);
  });

  it('gives a single material the whole budget', () => {
    expect(computeQuotas(200, 1)).toEqual([200]);
    expect(computeQuotas(50, 1)).toEqual([50]);
  });

  it('never overshoots the total, unlike a plain ceil', () => {
    for (const [total, count] of [[200, 3], [50, 3], [10, 3], [7, 4]]) {
      const quotas = computeQuotas(total, count);
      expect(quotas).toHaveLength(count);
      expect(quotas.reduce((a, b) => a + b, 0)).toBe(total);
    }
  });
});

describe('mergePerMaterialChunks', () => {
  it('spends the whole budget when every material is dense', () => {
    const merged = mergePerMaterialChunks(
      [chunksFrom('A', 200), chunksFrom('B', 200), chunksFrom('C', 200)],
      200
    );
    expect(merged).toHaveLength(200);
  });

  it('guarantees a sparse material every chunk it has', () => {
    const merged = mergePerMaterialChunks(
      [chunksFrom('A', 200, 0.99), chunksFrom('B', 200, 0.98), chunksFrom('C', 12, 0.10)],
      200
    );

    const ids = sourceIdsOf(merged);
    // C scores far below A and B, yet all 12 of its chunks survive.
    expect(ids.filter((id) => id === 'C')).toHaveLength(12);
    expect(merged).toHaveLength(200);
  });

  it('redistributes unclaimed budget to the highest-scoring surplus', () => {
    const merged = mergePerMaterialChunks(
      [chunksFrom('A', 200, 0.99), chunksFrom('B', 200, 0.50), chunksFrom('C', 12, 0.10)],
      200
    );

    const ids = sourceIdsOf(merged);
    // Quotas are 67/67/66; C used only 12, freeing 54. A outscores B, so A
    // takes the redistributed budget.
    expect(ids.filter((id) => id === 'A').length).toBeGreaterThan(67);
    expect(ids.filter((id) => id === 'B')).toHaveLength(67);
    expect(ids.filter((id) => id === 'C')).toHaveLength(12);
  });

  it('returns everything available when all materials are sparse', () => {
    const merged = mergePerMaterialChunks(
      [chunksFrom('A', 3), chunksFrom('B', 2), chunksFrom('C', 1)],
      200
    );
    expect(merged).toHaveLength(6);
  });

  it('handles a material that returned nothing', () => {
    const merged = mergePerMaterialChunks([chunksFrom('A', 5), [], chunksFrom('C', 5)], 200);
    expect(merged).toHaveLength(10);
  });
});

describe('retrieveChunksPerMaterial', () => {
  it('issues exactly one search per material at the full budget', async () => {
    const instance = fakeInstance({
      A: chunksFrom('A', 100),
      B: chunksFrom('B', 100),
      C: chunksFrom('C', 100),
    });

    await retrieveChunksPerMaterial(instance, ['A', 'B', 'C'], 'query', {
      totalLimit: 200,
      scoreThreshold: 0.6,
    });

    // Surplus for redistribution is fetched up front, so three materials cost
    // three searches — never a second round.
    expect(instance.searches).toHaveLength(3);
    expect(instance.searches.map((s) => s.limit)).toEqual([200, 200, 200]);
  });

  it('is unchanged from a single union search for one material', async () => {
    const instance = fakeInstance({ A: chunksFrom('A', 30) });

    const merged = await retrieveChunksPerMaterial(instance, ['A'], 'query', {
      totalLimit: 50,
      scoreThreshold: 0.6,
    });

    expect(instance.searches).toEqual([{ sourceId: 'A', limit: 50, scoreThreshold: 0.6 }]);
    expect(merged).toHaveLength(30);
  });

  it('retries only the material the threshold emptied', async () => {
    const instance = fakeInstance(
      { A: chunksFrom('A', 10), B: chunksFrom('B', 10), C: chunksFrom('C', 10) },
      { emptyWithThreshold: ['B'] }
    );

    const merged = await retrieveChunksPerMaterial(instance, ['A', 'B', 'C'], 'query', {
      totalLimit: 50,
      scoreThreshold: 0.6,
    });

    // B searches twice (thresholded, then not); A and C once each.
    expect(instance.searches.filter((s) => s.sourceId === 'B')).toHaveLength(2);
    expect(instance.searches.filter((s) => s.sourceId === 'A')).toHaveLength(1);
    expect(instance.searches.filter((s) => s.sourceId === 'C')).toHaveLength(1);
    expect(sourceIdsOf(merged)).toContain('B');
  });

  it('keeps the other materials when one search fails', async () => {
    const instance = fakeInstance(
      { A: chunksFrom('A', 10), B: chunksFrom('B', 10), C: chunksFrom('C', 10) },
      { failFor: ['B'] }
    );

    const merged = await retrieveChunksPerMaterial(instance, ['A', 'B', 'C'], 'query', {
      totalLimit: 50,
    });

    const ids = sourceIdsOf(merged);
    expect(ids).toContain('A');
    expect(ids).toContain('C');
    expect(ids).not.toContain('B');
  });

  it('propagates the failure when every search fails', async () => {
    const instance = fakeInstance({}, { failFor: ['A', 'B'] });

    await expect(
      retrieveChunksPerMaterial(instance, ['A', 'B'], 'query', { totalLimit: 50 })
    ).rejects.toThrow('qdrant unavailable');
  });

  it('returns an empty list when every material is legitimately empty', async () => {
    const instance = fakeInstance({ A: [], B: [] });

    await expect(
      retrieveChunksPerMaterial(instance, ['A', 'B'], 'query', { totalLimit: 50 })
    ).resolves.toEqual([]);
  });

  it('deduplicates repeated sourceIds into one search per unique material', async () => {
    const instance = fakeInstance({
      A: chunksFrom('A', 10),
      B: chunksFrom('B', 10),
    });

    const merged = await retrieveChunksPerMaterial(instance, ['A', 'A', 'B'], 'query', {
      totalLimit: 50,
    });

    // Only one search per unique material, not one per array entry.
    expect(instance.searches).toHaveLength(2);
    expect(instance.searches.map((s) => s.sourceId).sort()).toEqual(['A', 'B']);

    // A's chunks appear exactly once each — no doubled content from the
    // duplicate sourceId, and no quota given away to a phantom third search.
    const ids = sourceIdsOf(merged);
    expect(ids.filter((id) => id === 'A')).toHaveLength(10);
    expect(ids.filter((id) => id === 'B')).toHaveLength(10);
    expect(merged).toHaveLength(20);
  });
});

describe('formatChunksByMaterial', () => {
  it('groups chunks under a header per material', () => {
    const formatted = formatChunksByMaterial([
      chunk('A', 0.9),
      chunk('B', 0.8),
      chunk('A', 0.7),
    ]);

    expect(formatted).toContain('### MATERIAL: Title A (SOURCE ID: A)');
    expect(formatted).toContain('### MATERIAL: Title B (SOURCE ID: B)');
    expect(formatted).toContain('\n\n---\n\n');
    // Both A chunks sit in A's block, not in two separate A blocks.
    expect(formatted.match(/### MATERIAL: Title A/g)).toHaveLength(1);
  });

  it('falls back to fileName then Unknown Source for the title', () => {
    const formatted = formatChunksByMaterial([
      { content: 'x', score: 0.5, metadata: { sourceId: 'A', fileName: 'lecture.pdf' } },
      { content: 'y', score: 0.4, metadata: { sourceId: 'B' } },
    ]);

    expect(formatted).toContain('### MATERIAL: lecture.pdf (SOURCE ID: A)');
    expect(formatted).toContain('### MATERIAL: Unknown Source (SOURCE ID: B)');
  });

  it('returns an empty string for no chunks', () => {
    expect(formatChunksByMaterial([])).toBe('');
    expect(formatChunksByMaterial(null)).toBe('');
  });
});
