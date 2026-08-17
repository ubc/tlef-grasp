/**
 * Per-material RAG retrieval strategy.
 *
 * A single vector search over the union of several materials ranks purely by
 * similarity, so one dense material can take every slot and a material the
 * instructor deliberately attached can contribute nothing. This module searches
 * each material separately, guarantees each a share of a fixed chunk budget,
 * then spends any unclaimed budget on the best remaining chunks.
 *
 * Every function takes its RAG instance as an argument and returns plain data.
 * That is deliberate: `rag.js` is a singleton whose constructor dynamically
 * imports the UBC GenAI Toolkit and cannot be required under Jest, so the logic
 * worth testing lives here instead.
 */

const { generationLimiter } = require('../utils/generation-limiter');

/**
 * Chunks each material is guaranteed before redistribution. Uses floor plus a
 * remainder spread over the first materials so the quotas sum to exactly
 * totalLimit — a plain ceil would overshoot (ceil(200/3) * 3 === 201).
 * @param {number} totalLimit
 * @param {number} materialCount
 * @returns {Array<number>}
 */
const computeQuotas = (totalLimit, materialCount) => {
  const base = Math.floor(totalLimit / materialCount);
  const remainder = totalLimit % materialCount;
  return Array.from(
    { length: materialCount },
    (_, index) => base + (index < remainder ? 1 : 0)
  );
};

/**
 * Search a single material, retrying without the score threshold if it filtered
 * everything out. Applied per material rather than across the union so one weak
 * material cannot suppress its neighbours.
 */
const retrieveForSource = async (instance, sourceId, query, limit, scoreThreshold) => {
  const filter = { must: [{ key: 'sourceId', match: { any: [sourceId] } }] };

  // Under the generation limiter: each objective issues 3-5 searches, each
  // preceded by an embedding call, so concurrent objectives multiply fast.
  let chunks = await generationLimiter.run(() =>
    instance.retrieveContext(query, { limit, scoreThreshold, filter })
  );

  if ((!chunks || chunks.length === 0) && scoreThreshold !== undefined) {
    console.log(
      `⚠️ Score threshold ${scoreThreshold} returned 0 chunks for material ${sourceId} — retrying without threshold`
    );
    chunks = await generationLimiter.run(() =>
      instance.retrieveContext(query, { limit, filter })
    );
  }

  return chunks || [];
};

/**
 * Keep each material's quota, then fill the unspent remainder from the pooled
 * surplus in score order. Redistribution only ever spends budget that quotas did
 * not claim, so it can never push a material below its guaranteed share — that
 * property is what fixes the crowd-out.
 * @param {Array<Array<object>>} perMaterialChunks
 * @param {number} totalLimit
 * @returns {Array<object>}
 */
const mergePerMaterialChunks = (perMaterialChunks, totalLimit) => {
  const quotas = computeQuotas(totalLimit, perMaterialChunks.length || 1);

  const kept = [];
  const surplus = [];
  perMaterialChunks.forEach((chunks, index) => {
    const quota = quotas[index];
    kept.push(...chunks.slice(0, quota));
    surplus.push(...chunks.slice(quota));
  });

  const remaining = totalLimit - kept.length;
  if (remaining > 0 && surplus.length > 0) {
    surplus.sort((a, b) => (b.score || 0) - (a.score || 0));
    kept.push(...surplus.slice(0, remaining));
  }

  return kept;
};

/**
 * Fan out one search per material and merge the results.
 *
 * Each search requests the full budget rather than just the material's quota, so
 * the surplus needed for redistribution is already in hand. Retrieval therefore
 * stays at exactly one search per material.
 *
 * @param {object} instance - RAG instance exposing retrieveContext
 * @param {Array<string>} sourceIds
 * @param {string} query
 * @param {{ totalLimit: number, scoreThreshold?: number }} options
 * @returns {Promise<Array<object>>}
 */
const retrieveChunksPerMaterial = async (
  instance,
  sourceIds,
  query,
  { totalLimit, scoreThreshold } = {}
) => {
  // A duplicate id would otherwise issue two identical searches, get counted
  // twice for quota purposes, and emit every chunk twice — halving the
  // effective budget with duplicate content. Dedup once, up front, and use
  // this list for the searches, the quota count, and the failure index below.
  const uniqueSourceIds = [...new Set(sourceIds)];

  const settled = await Promise.allSettled(
    uniqueSourceIds.map((sourceId) =>
      retrieveForSource(instance, sourceId, query, totalLimit, scoreThreshold)
    )
  );

  // One material failing must not cost the others their context.
  const perMaterialChunks = settled.map((outcome, index) => {
    if (outcome.status === 'rejected') {
      console.warn(
        `⚠️ RAG search failed for material ${uniqueSourceIds[index]}:`,
        outcome.reason?.message || outcome.reason
      );
      return [];
    }
    return outcome.value;
  });

  // Total failure is a real error, not an empty result set.
  if (settled.length > 0 && settled.every((outcome) => outcome.status === 'rejected')) {
    throw settled[0].reason;
  }

  const merged = mergePerMaterialChunks(perMaterialChunks, totalLimit);

  const contributing = perMaterialChunks.filter((chunks) => chunks.length > 0).length;
  console.log(
    `✅ Retrieved ${merged.length} chunks from ${contributing}/${uniqueSourceIds.length} materials (budget ${totalLimit}, threshold ${scoreThreshold ?? 'none'})`
  );

  return merged;
};

/**
 * Group chunks under a header per material, for prompts that cite their sources.
 * Output format is load-bearing: the objective-generation prompt relies on
 * this `### MATERIAL: <title> (SOURCE ID: <sid>)` header for per-material
 * attribution. `renderOutlineBlock` (src/utils/outline-text.js) emits the same
 * header for the outline path, so the two producers must not drift apart.
 */
const formatChunksByMaterial = (chunks) => {
  if (!chunks || chunks.length === 0) {
    console.log('⚠️ No relevant chunks found in RAG for selected materials');
    return '';
  }

  const chunksBySource = {};
  chunks.forEach((chunk) => {
    const sourceId = chunk.metadata?.sourceId || 'Unknown';
    if (!chunksBySource[sourceId]) {
      chunksBySource[sourceId] = {
        title:
          chunk.metadata?.documentTitle || chunk.metadata?.fileName || 'Unknown Source',
        contents: [],
      };
    }
    chunksBySource[sourceId].contents.push(chunk.content);
  });

  return Object.entries(chunksBySource)
    .map(
      ([sourceId, data]) =>
        `### MATERIAL: ${data.title} (SOURCE ID: ${sourceId})\n${data.contents.join('\n\n')}`
    )
    .join('\n\n---\n\n');
};

module.exports = {
  computeQuotas,
  retrieveForSource,
  mergePerMaterialChunks,
  retrieveChunksPerMaterial,
  formatChunksByMaterial,
};
