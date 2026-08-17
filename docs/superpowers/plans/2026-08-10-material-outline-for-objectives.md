# Material Outlines for Objective Generation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Summarize each course material once into a structured, instructor-editable outline, and build the learning-objective prompt from outlines instead of 200 similarity-ranked chunks.

**Architecture:** Pure text helpers (batching, validation, rendering) live in `src/utils/outline-text.js` with no dependencies. A service, `src/services/material-outline.js`, owns database and LLM orchestration behind three deliberately separate calls — `getOutline` never generates, `generateOutline` always does, `saveOutline` stores an instructor edit. Objective generation reads outlines and falls back to today's RAG retrieval when one is missing; it never generates. Three routes plus a materials-page modal let instructors view, edit, and regenerate.

**Tech Stack:** Node.js + Express + MongoDB (native driver), Qdrant via `ubc-genai-toolkit-rag`, OpenAI/Ollama via `generateStructured`, React 18 + Vite + React Query + Tailwind, Jest for server unit tests.

**Spec:** `docs/superpowers/specs/2026-08-10-material-outline-for-objectives-design.md`

## Global Constraints

- **Plain JavaScript, no TypeScript.** Server modules are CommonJS (`require`/`module.exports`); client modules are ESM (`import`/`export`).
- **`getOutline` must never invoke the LLM.** Objective generation must never generate an outline. These are the whole point of the split API — violating either reintroduces a multi-second LLM call inside a user's click.
- **`fileContent` is never modified.** The outline is derived data stored alongside it.
- **`notes` is system-owned.** It holds model caveats plus the code-generated truncation sentence. `saveOutline` and the `PUT` route must ignore any caller-supplied `notes`, `outlineModel`, or `outlinePromptHash`.
- **Edited outlines never go stale.** When `outlineSource === 'edited'`, staleness checks return false regardless of model or prompt hash.
- **The materials list must not include `outline`.** It gains a computed `hasOutline` boolean instead.
- **Do not touch `fileContent` in the list payload.** Trimming it is a known separate issue, explicitly out of scope (spec §10).
- **Question generation is untouched.** No changes to `getLearningObjectiveRagContent`, `rag-fanout.js`, or `RAG_QUESTION_CHUNK_LIMIT` / `RAG_QUESTION_SCORE_THRESHOLD`.
- **Prompt block format is load-bearing** — `### MATERIAL: <title> (SOURCE ID: <sid>)` blocks joined by `\n\n---\n\n`, matching what retrieval emits today so the objective prompt contract does not change.
- **Constant values:** `OUTLINE_DIRECT_MAX_CHARS = 100000`, `OUTLINE_BATCH_CHARS = 80000`, `OUTLINE_MAX_BATCHES = 8`, `MAX_OUTLINE_TOPICS = 40`, `MAX_OUTLINE_KEY_POINTS = 20`, `MAX_OUTLINE_CHARS = 20000`.
- **Error codes:** exactly `EMPTY_MATERIAL`, `NO_OUTLINE`, `INVALID_OUTLINE`.
- **Run server tests with** `npx jest <path>`; full suite `npm run test:unit`. Client build: `npm run build`.
- **There is no client-side test framework.** Do not add Vitest or Jest to `client/`.
- **Do not run `npm run dev`** or attempt browser checks; a human does those.
- **Commit after every task** using the message given.

---

### Task 1: Pure outline text helpers

Batching, validation, and prompt rendering, with no database or LLM dependency so all of it is testable directly.

**Files:**
- Create: `src/utils/outline-text.js`
- Test: `tests/unit/outline-text.utils.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces, all exported from `src/utils/outline-text.js`:
  - `batchContent(text, { batchChars, maxBatches })` → `{ batches: string[], totalChars: number, coveredChars: number, truncated: boolean }`
  - `validateOutline(outline, { maxTopics, maxKeyPoints, maxChars })` → `{ ok: true, outline }` or `{ ok: false, error: string }`
  - `renderOutlineBlock({ documentTitle, sourceId, outline })` → `string`
  - `truncationNote(coveredChars, totalChars)` → `string`
  - An outline is `{ topics: [{ title: string, keyPoints: string[] }], notes: string }`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/outline-text.utils.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/outline-text.utils.test.js`

Expected: FAIL with `Cannot find module '../../src/utils/outline-text'`.

- [ ] **Step 3: Write the implementation**

Create `src/utils/outline-text.js`:

```js
/**
 * Pure helpers for material outlines: splitting source text into
 * summarizable batches, validating an outline (whether model- or
 * instructor-authored), and rendering one for a prompt.
 *
 * Nothing here touches the database, the LLM, or the RAG service, so all of it
 * is testable directly.
 */

/** Matches the "Page N:" markers the PDF parser writes at each page start. */
const PAGE_MARKER = /(?=^Page \d+:$)/m;

/**
 * Split text into batches of at most `batchChars`, preferring page boundaries so
 * a batch does not straddle a page mid-sentence. Stops after `maxBatches` and
 * reports the truncation rather than silently dropping the remainder.
 */
const batchContent = (text, { batchChars, maxBatches }) => {
  const source = typeof text === 'string' ? text : '';
  const totalChars = source.length;

  if (!source.trim()) {
    return { batches: [], totalChars, coveredChars: 0, truncated: false };
  }

  // Split at page markers where the parser produced them; otherwise one segment.
  const segments = source
    .split(PAGE_MARKER)
    .filter((segment) => segment.length > 0);

  // A segment longer than a batch is hard-split; nothing else can be done.
  const units = [];
  segments.forEach((segment) => {
    for (let i = 0; i < segment.length; i += batchChars) {
      units.push(segment.slice(i, i + batchChars));
    }
  });

  // Greedily pack units into batches without exceeding batchChars.
  const batches = [];
  let current = '';
  units.forEach((unit) => {
    if (current && current.length + unit.length > batchChars) {
      batches.push(current);
      current = unit;
    } else {
      current += unit;
    }
  });
  if (current) batches.push(current);

  const kept = batches.slice(0, maxBatches);
  const coveredChars = kept.reduce((sum, batch) => sum + batch.length, 0);

  return {
    batches: kept,
    totalChars,
    coveredChars,
    truncated: batches.length > maxBatches,
  };
};

/**
 * Validate and normalize an outline. Used for both model output and instructor
 * edits, so it must not assume a trustworthy source.
 */
const validateOutline = (outline, { maxTopics, maxKeyPoints, maxChars }) => {
  if (!outline || typeof outline !== 'object') {
    return { ok: false, error: 'Outline must be an object.' };
  }
  if (!Array.isArray(outline.topics)) {
    return { ok: false, error: 'Outline must have a topics array.' };
  }
  if (outline.topics.length === 0) {
    return { ok: false, error: 'An outline needs at least one topic.' };
  }
  if (outline.topics.length > maxTopics) {
    return { ok: false, error: `An outline may have at most ${maxTopics} topics.` };
  }

  const topics = [];
  for (const topic of outline.topics) {
    if (!topic || typeof topic !== 'object') {
      return { ok: false, error: 'Each topic must be an object.' };
    }
    if (typeof topic.title !== 'string' || !topic.title.trim()) {
      return { ok: false, error: 'Every topic needs a non-empty title.' };
    }
    if (topic.keyPoints !== undefined && !Array.isArray(topic.keyPoints)) {
      return { ok: false, error: `Key points for "${topic.title}" must be an array.` };
    }
    const rawPoints = topic.keyPoints || [];
    if (rawPoints.length > maxKeyPoints) {
      return {
        ok: false,
        error: `Topic "${topic.title}" may have at most ${maxKeyPoints} key points.`,
      };
    }
    const keyPoints = [];
    for (const point of rawPoints) {
      if (typeof point !== 'string' || !point.trim()) {
        return { ok: false, error: `Key points for "${topic.title}" must be non-empty text.` };
      }
      keyPoints.push(point.trim());
    }
    topics.push({ title: topic.title.trim(), keyPoints });
  }

  const notes = typeof outline.notes === 'string' ? outline.notes.trim() : '';

  const size = JSON.stringify({ topics, notes }).length;
  if (size > maxChars) {
    return { ok: false, error: `An outline may be at most ${maxChars} characters.` };
  }

  return { ok: true, outline: { topics, notes } };
};

/**
 * Render one material's outline as a prompt block. The header and separator
 * format matches what the retrieval path emits, so the objective prompt's
 * expectations do not change.
 */
const renderOutlineBlock = ({ documentTitle, sourceId, outline }) => {
  const title = (documentTitle || '').trim() || 'Untitled material';
  const lines = [`### MATERIAL: ${title} (SOURCE ID: ${sourceId})`];

  outline.topics.forEach((topic) => {
    lines.push(`## ${topic.title}`);
    topic.keyPoints.forEach((point) => lines.push(`- ${point}`));
  });

  if (outline.notes) {
    lines.push('', `NOTES: ${outline.notes}`);
  }

  return lines.join('\n');
};

/** Deterministic note recorded when coverage was capped. */
const truncationNote = (coveredChars, totalChars) =>
  `This outline covers the first ${coveredChars} of ${totalChars} characters of the material; later sections were not summarized.`;

module.exports = {
  batchContent,
  validateOutline,
  renderOutlineBlock,
  truncationNote,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/outline-text.utils.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/outline-text.js tests/unit/outline-text.utils.test.js
git commit -m "Add pure helpers for outline batching, validation, and rendering

Batching prefers the Page N: markers the PDF parser already writes so a
summarization batch does not straddle a page. Validation is shared between
model output and instructor edits, so it assumes neither is trustworthy."
```

---

### Task 2: Schema, prompt, constants, and outline storage

The generation-independent groundwork plus the storage primitives, so Task 3 has somewhere to write to.

**Files:**
- Modify: `src/constants/llm-schemas.js` (add `MATERIAL_OUTLINE_SCHEMA`, export it)
- Modify: `src/constants/app-constants.js` (add `MATERIAL_OUTLINE_PROMPT`, the six numeric constants, a `DEFAULT_PROMPTS.materialOutline` entry, export all)
- Modify: `src/services/material.js` (add `setMaterialOutline`, `clearMaterialOutline`, export both)
- Test: `tests/unit/material-outline-storage.service.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `MATERIAL_OUTLINE_SCHEMA` from `src/constants/llm-schemas.js`
  - From `src/constants/app-constants.js`: `MATERIAL_OUTLINE_PROMPT`, `OUTLINE_DIRECT_MAX_CHARS` (100000), `OUTLINE_BATCH_CHARS` (80000), `OUTLINE_MAX_BATCHES` (8), `MAX_OUTLINE_TOPICS` (40), `MAX_OUTLINE_KEY_POINTS` (20), `MAX_OUTLINE_CHARS` (20000), and `DEFAULT_PROMPTS.materialOutline`
  - From `src/services/material.js`: `setMaterialOutline(sourceId, fields)` → `void`, `clearMaterialOutline(sourceId)` → `void`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/material-outline-storage.service.test.js`:

```js
jest.mock('../../src/services/database', () => ({ connect: jest.fn() }));

const databaseService = require('../../src/services/database');
const { setMaterialOutline, clearMaterialOutline } = require('../../src/services/material');
const { MATERIAL_OUTLINE_SCHEMA } = require('../../src/constants/llm-schemas');
const {
  MATERIAL_OUTLINE_PROMPT,
  DEFAULT_PROMPTS,
  OUTLINE_DIRECT_MAX_CHARS,
  OUTLINE_BATCH_CHARS,
  OUTLINE_MAX_BATCHES,
  MAX_OUTLINE_TOPICS,
  MAX_OUTLINE_KEY_POINTS,
  MAX_OUTLINE_CHARS,
} = require('../../src/constants/app-constants');

describe('outline constants and schema', () => {
  it('exposes the documented numeric values', () => {
    expect(OUTLINE_DIRECT_MAX_CHARS).toBe(100000);
    expect(OUTLINE_BATCH_CHARS).toBe(80000);
    expect(OUTLINE_MAX_BATCHES).toBe(8);
    expect(MAX_OUTLINE_TOPICS).toBe(40);
    expect(MAX_OUTLINE_KEY_POINTS).toBe(20);
    expect(MAX_OUTLINE_CHARS).toBe(20000);
  });

  it('exposes a prompt with the placeholders the service fills', () => {
    expect(MATERIAL_OUTLINE_PROMPT).toContain('{materialContent}');
    expect(DEFAULT_PROMPTS.materialOutline).toBe(MATERIAL_OUTLINE_PROMPT);
  });

  it('constrains the schema to topics and notes', () => {
    expect(MATERIAL_OUTLINE_SCHEMA.properties.topics).toBeDefined();
    expect(MATERIAL_OUTLINE_SCHEMA.properties.notes).toBeDefined();
    expect(MATERIAL_OUTLINE_SCHEMA.additionalProperties).toBe(false);
    expect(MATERIAL_OUTLINE_SCHEMA.required).toEqual(
      expect.arrayContaining(['topics', 'notes'])
    );
  });
});

describe('outline storage', () => {
  let collection;

  beforeEach(() => {
    collection = { updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }) };
    databaseService.connect.mockResolvedValue({
      collection: jest.fn((name) => {
        if (name === 'grasp_material') return collection;
        throw new Error(`Unexpected collection: ${name}`);
      }),
    });
  });

  it('sets the outline fields for one material', async () => {
    const fields = { outline: { topics: [], notes: '' }, outlineSource: 'generated' };

    await setMaterialOutline('src-1', fields);

    expect(collection.updateOne).toHaveBeenCalledWith(
      { sourceId: 'src-1' },
      { $set: fields }
    );
  });

  it('unsets every outline field when clearing', async () => {
    await clearMaterialOutline('src-1');

    const [filter, update] = collection.updateOne.mock.calls[0];
    expect(filter).toEqual({ sourceId: 'src-1' });
    expect(Object.keys(update.$unset).sort()).toEqual([
      'outline',
      'outlineEditedAt',
      'outlineGeneratedAt',
      'outlineModel',
      'outlinePromptHash',
      'outlineSource',
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/material-outline-storage.service.test.js`

Expected: FAIL — `OUTLINE_DIRECT_MAX_CHARS` is `undefined` and `setMaterialOutline` is not a function.

- [ ] **Step 3: Add the schema**

In `src/constants/llm-schemas.js`, add above `module.exports` and add the name to the exports object:

```js
const MATERIAL_OUTLINE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    topics: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          keyPoints: { type: "array", items: { type: "string" } },
        },
        required: ["title", "keyPoints"],
      },
    },
    notes: { type: "string" },
  },
  required: ["topics", "notes"],
};
```

- [ ] **Step 4: Add the prompt and constants**

In `src/constants/app-constants.js`, add above `module.exports`:

```js
/**
 * Maximum characters summarized in a single call. Above this, the material is
 * summarized in batches and consolidated.
 */
const OUTLINE_DIRECT_MAX_CHARS = 100000;
/** Batch size when a material exceeds OUTLINE_DIRECT_MAX_CHARS. */
const OUTLINE_BATCH_CHARS = 80000;
/**
 * Coverage cap. Past this many batches summarization stops and records the
 * truncation, so one pathological upload cannot run unbounded LLM calls.
 */
const OUTLINE_MAX_BATCHES = 8;

/** Caps on a stored outline, applied to model output and instructor edits alike. */
const MAX_OUTLINE_TOPICS = 40;
const MAX_OUTLINE_KEY_POINTS = 20;
const MAX_OUTLINE_CHARS = 20000;

const MATERIAL_OUTLINE_PROMPT = `You are an expert educational content designer. Summarize the following course material into a structured outline that captures everything a set of learning objectives would need to cover.

COURSE MATERIAL:
{materialContent}

INSTRUCTIONS:
1. Identify the distinct topics the material teaches, in the order the material presents them.
2. For each topic, list the key points a student is expected to learn — concepts, definitions, relationships, methods, and worked results.
3. Use the material's own terminology. Do not introduce topics the material does not cover.
4. Do not editorialize about the material's quality, and do not add study advice.
5. If the material is not teachable course content (a receipt, a syllabus administrative page, navigation text, personal notes), say so plainly in notes and return the few topics that are genuinely present.
6. Use notes only for caveats about the material itself — for example sparse text from a scan, or content that appears truncated. Leave notes as an empty string when there is nothing to report.
7. CRITICAL LaTeX FORMATTING: enclose all mathematical notation and chemical formulas in \\\\( and \\\\) for inline math (e.g. \\\\( x^2 \\\\) or \\\\( H_2O \\\\)). Do NOT use parentheses () or $ for math delimiters.`;
```

Add all seven names plus `materialOutline: MATERIAL_OUTLINE_PROMPT` inside the existing `DEFAULT_PROMPTS` object, and add each constant to `module.exports`.

- [ ] **Step 5: Add the storage helpers**

In `src/services/material.js`, add before `module.exports` and add both names to the exports:

```js
const OUTLINE_FIELDS = [
    'outline',
    'outlineGeneratedAt',
    'outlineModel',
    'outlinePromptHash',
    'outlineSource',
    'outlineEditedAt',
];

/** Write outline fields for one material. */
const setMaterialOutline = async (sourceId, fields) => {
    try {
        const db = await databaseService.connect();
        const collection = db.collection("grasp_material");
        await collection.updateOne({ sourceId: sourceId }, { $set: fields });
    }
    catch (error) {
        console.error("Error setting material outline:", error);
        throw error;
    }
};

/**
 * Remove every outline field. Called when a material's content changes: the
 * outline described text that no longer exists, including any instructor edits.
 */
const clearMaterialOutline = async (sourceId) => {
    try {
        const db = await databaseService.connect();
        const collection = db.collection("grasp_material");
        const unset = {};
        OUTLINE_FIELDS.forEach((field) => { unset[field] = ""; });
        await collection.updateOne({ sourceId: sourceId }, { $unset: unset });
    }
    catch (error) {
        console.error("Error clearing material outline:", error);
        throw error;
    }
};
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx jest tests/unit/material-outline-storage.service.test.js`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/constants/llm-schemas.js src/constants/app-constants.js src/services/material.js tests/unit/material-outline-storage.service.test.js
git commit -m "Add outline schema, prompt, caps, and storage helpers

Constants and the summarization prompt follow the existing DEFAULT_PROMPTS
pattern so the prompt is instructor-editable through settings. Clearing unsets
every outline field, including edit provenance, because a content change
invalidates instructor edits too."
```

---

### Task 3: `getOutline` and `generateOutline` (single-call path)

The service read path and generation for materials that fit one call. Map-reduce comes in Task 4.

**Files:**
- Create: `src/services/material-outline.js`
- Test: `tests/unit/material-outline.service.test.js`

**Interfaces:**
- Consumes: `batchContent`, `validateOutline`, `truncationNote` from `src/utils/outline-text.js`; `MATERIAL_OUTLINE_SCHEMA`; `MATERIAL_OUTLINE_PROMPT`, `DEFAULT_PROMPTS`, and the six caps from `src/constants/app-constants.js`; `getMaterialBySourceId`, `setMaterialOutline` from `src/services/material.js`; `generateStructured({ prompt, schema, temperature, schemaName })` from `src/utils/structured-llm.js`; `getLLMModel()` from `src/utils/llm-provider.js`; `getSettings(courseId)` from `src/services/settings.js`.
- Produces, from `src/services/material-outline.js`:
  - `getOutline(sourceId)` → `null`, or `{ outline, source, generatedAt, editedAt, stale }` where `source` is `'generated' | 'edited'` and `stale` is boolean
  - `generateOutline(sourceId)` → the same shape, never null
  - `promptHashFor(template)` → `string` (first 16 hex chars of SHA-256)
  - `EmptyMaterialError` with `code === 'EMPTY_MATERIAL'`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/material-outline.service.test.js`:

```js
const mockGenerateStructured = jest.fn();

jest.mock('../../src/utils/structured-llm', () => ({
  generateStructured: mockGenerateStructured,
}));
jest.mock('../../src/utils/llm-provider', () => ({
  getLLMModel: jest.fn(() => 'test-model'),
}));
jest.mock('../../src/services/settings', () => ({
  getSettings: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../src/services/material', () => ({
  getMaterialBySourceId: jest.fn(),
  setMaterialOutline: jest.fn(),
  clearMaterialOutline: jest.fn(),
}));

const materialService = require('../../src/services/material');
const {
  getOutline,
  generateOutline,
  promptHashFor,
  EmptyMaterialError,
} = require('../../src/services/material-outline');
const { MATERIAL_OUTLINE_PROMPT } = require('../../src/constants/app-constants');

const OUTLINE = { topics: [{ title: 'Topic A', keyPoints: ['Point one'] }], notes: '' };

const storedMaterial = (overrides = {}) => ({
  sourceId: 'src-1',
  courseId: 'course-1',
  documentTitle: 'Lecture 3',
  fileContent: 'Some teachable course content about respiration.',
  outline: OUTLINE,
  outlineSource: 'generated',
  outlineGeneratedAt: new Date('2026-08-01'),
  outlineModel: 'test-model',
  outlinePromptHash: promptHashFor(MATERIAL_OUTLINE_PROMPT),
  ...overrides,
});

beforeEach(() => {
  mockGenerateStructured.mockReset();
  mockGenerateStructured.mockResolvedValue({
    content: JSON.stringify(OUTLINE),
    usage: {},
  });
  // Jest's clearMocks resets call records but not implementations, so a test
  // that overrides getSettings would otherwise leak its custom prompt into
  // every test that runs after it.
  require('../../src/services/settings').getSettings.mockResolvedValue(null);
});

describe('getOutline', () => {
  it('never invokes the LLM', async () => {
    materialService.getMaterialBySourceId.mockResolvedValue(storedMaterial());

    await getOutline('src-1');

    expect(mockGenerateStructured).not.toHaveBeenCalled();
  });

  it('returns null when the material has no outline', async () => {
    materialService.getMaterialBySourceId.mockResolvedValue(
      storedMaterial({ outline: undefined })
    );

    await expect(getOutline('src-1')).resolves.toBeNull();
    expect(mockGenerateStructured).not.toHaveBeenCalled();
  });

  it('returns null when the material does not exist', async () => {
    materialService.getMaterialBySourceId.mockResolvedValue(null);
    await expect(getOutline('nope')).resolves.toBeNull();
  });

  it('returns the stored outline with provenance', async () => {
    materialService.getMaterialBySourceId.mockResolvedValue(storedMaterial());

    const result = await getOutline('src-1');

    expect(result.outline).toEqual(OUTLINE);
    expect(result.source).toBe('generated');
    expect(result.stale).toBe(false);
  });

  it('reports a malformed stored outline as absent', async () => {
    materialService.getMaterialBySourceId.mockResolvedValue(
      storedMaterial({ outline: { topics: [] } })
    );

    await expect(getOutline('src-1')).resolves.toBeNull();
  });

  it('marks stale on a model mismatch', async () => {
    materialService.getMaterialBySourceId.mockResolvedValue(
      storedMaterial({ outlineModel: 'some-older-model' })
    );

    await expect(getOutline('src-1')).resolves.toMatchObject({ stale: true });
  });

  it('marks stale on a prompt-hash mismatch', async () => {
    materialService.getMaterialBySourceId.mockResolvedValue(
      storedMaterial({ outlinePromptHash: 'deadbeefdeadbeef' })
    );

    await expect(getOutline('src-1')).resolves.toMatchObject({ stale: true });
  });

  // An edited outline no longer reflects the prompt or model that produced it,
  // so comparing against them is meaningless — and nagging the instructor to
  // regenerate would invite discarding their own work.
  it('never marks an edited outline stale', async () => {
    materialService.getMaterialBySourceId.mockResolvedValue(
      storedMaterial({
        outlineSource: 'edited',
        outlineModel: 'some-older-model',
        outlinePromptHash: 'deadbeefdeadbeef',
      })
    );

    await expect(getOutline('src-1')).resolves.toMatchObject({
      source: 'edited',
      stale: false,
    });
  });
});

describe('generateOutline', () => {
  it('summarizes a small material in one call and stores provenance', async () => {
    materialService.getMaterialBySourceId.mockResolvedValue(
      storedMaterial({ outline: undefined })
    );

    const result = await generateOutline('src-1');

    expect(mockGenerateStructured).toHaveBeenCalledTimes(1);
    expect(mockGenerateStructured.mock.calls[0][0].prompt).toContain(
      'Some teachable course content about respiration.'
    );
    expect(result.outline).toEqual(OUTLINE);
    expect(result.source).toBe('generated');

    const [sourceId, fields] = materialService.setMaterialOutline.mock.calls[0];
    expect(sourceId).toBe('src-1');
    expect(fields.outline).toEqual(OUTLINE);
    expect(fields.outlineSource).toBe('generated');
    expect(fields.outlineModel).toBe('test-model');
    expect(fields.outlinePromptHash).toBe(promptHashFor(MATERIAL_OUTLINE_PROMPT));
    expect(fields.outlineGeneratedAt).toBeInstanceOf(Date);
    expect(fields.outlineEditedAt).toBeNull();
  });

  it('overwrites an edited outline and resets provenance to generated', async () => {
    materialService.getMaterialBySourceId.mockResolvedValue(
      storedMaterial({ outlineSource: 'edited', outlineEditedAt: new Date('2026-08-05') })
    );

    const result = await generateOutline('src-1');

    expect(result.source).toBe('generated');
    expect(materialService.setMaterialOutline.mock.calls[0][1].outlineSource).toBe('generated');
    expect(materialService.setMaterialOutline.mock.calls[0][1].outlineEditedAt).toBeNull();
  });

  it('rejects a material with no extractable text', async () => {
    materialService.getMaterialBySourceId.mockResolvedValue(
      storedMaterial({ fileContent: '   ' })
    );

    await expect(generateOutline('src-1')).rejects.toMatchObject({
      code: 'EMPTY_MATERIAL',
    });
    expect(mockGenerateStructured).not.toHaveBeenCalled();
    expect(materialService.setMaterialOutline).not.toHaveBeenCalled();
  });

  it('rejects a missing material', async () => {
    materialService.getMaterialBySourceId.mockResolvedValue(null);

    await expect(generateOutline('nope')).rejects.toMatchObject({
      code: 'EMPTY_MATERIAL',
    });
  });

  it('propagates model output that fails validation instead of storing it', async () => {
    materialService.getMaterialBySourceId.mockResolvedValue(
      storedMaterial({ outline: undefined })
    );
    mockGenerateStructured.mockResolvedValue({
      content: JSON.stringify({ topics: [], notes: '' }),
      usage: {},
    });

    await expect(generateOutline('src-1')).rejects.toThrow();
    expect(materialService.setMaterialOutline).not.toHaveBeenCalled();
  });

  it('prefers a course-specific prompt from settings', async () => {
    materialService.getMaterialBySourceId.mockResolvedValue(
      storedMaterial({ outline: undefined })
    );
    require('../../src/services/settings').getSettings.mockResolvedValue({
      prompts: { materialOutline: 'CUSTOM {materialContent}' },
    });

    const result = await generateOutline('src-1');

    expect(mockGenerateStructured.mock.calls[0][0].prompt).toContain('CUSTOM ');
    expect(materialService.setMaterialOutline.mock.calls[0][1].outlinePromptHash).toBe(
      promptHashFor('CUSTOM {materialContent}')
    );
    expect(result.stale).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/material-outline.service.test.js`

Expected: FAIL with `Cannot find module '../../src/services/material-outline'`.

- [ ] **Step 3: Write the implementation**

Create `src/services/material-outline.js`:

```js
/**
 * Material outlines: a structured summary of a course material, generated once
 * and reused by learning-objective generation.
 *
 * The read and write paths are deliberately separate functions. A single
 * get-or-create would let any caller trigger a multi-second LLM call by
 * accident, which is exactly how summarization would end up inside an
 * instructor's objective-generation click. `getOutline` never invokes the LLM.
 */
const crypto = require('crypto');
const { getMaterialBySourceId, setMaterialOutline } = require('./material');
const settingsService = require('./settings');
const { generateStructured } = require('../utils/structured-llm');
const { getLLMModel } = require('../utils/llm-provider');
const { MATERIAL_OUTLINE_SCHEMA } = require('../constants/llm-schemas');
const {
  DEFAULT_PROMPTS,
  OUTLINE_DIRECT_MAX_CHARS,
  OUTLINE_BATCH_CHARS,
  OUTLINE_MAX_BATCHES,
  MAX_OUTLINE_TOPICS,
  MAX_OUTLINE_KEY_POINTS,
  MAX_OUTLINE_CHARS,
} = require('../constants/app-constants');
const {
  batchContent,
  validateOutline,
  truncationNote,
} = require('../utils/outline-text');

const CAPS = {
  maxTopics: MAX_OUTLINE_TOPICS,
  maxKeyPoints: MAX_OUTLINE_KEY_POINTS,
  maxChars: MAX_OUTLINE_CHARS,
};

/** Thrown when a material has no text to summarize. */
class EmptyMaterialError extends Error {
  constructor(sourceId) {
    super(`Material ${sourceId} has no extractable text to summarize.`);
    this.name = 'EmptyMaterialError';
    this.code = 'EMPTY_MATERIAL';
  }
}

/** Identifies the prompt an outline was produced with, for staleness checks. */
const promptHashFor = (template) =>
  crypto.createHash('sha256').update(String(template)).digest('hex').slice(0, 16);

const resolvePromptTemplate = async (courseId) => {
  const settings = await settingsService.getSettings(courseId);
  return settings?.prompts?.materialOutline || DEFAULT_PROMPTS.materialOutline;
};

/**
 * An outline is stale when the model or prompt behind it has changed. Edited
 * outlines are exempt: they no longer reflect either, and the instructor owns
 * them. Staleness only reports — it never triggers regeneration.
 */
const isStale = (material, currentPromptHash) => {
  if (material.outlineSource === 'edited') return false;
  if (material.outlineModel !== getLLMModel()) return true;
  return material.outlinePromptHash !== currentPromptHash;
};

const present = (material, outline) => ({
  outline,
  source: material.outlineSource === 'edited' ? 'edited' : 'generated',
  generatedAt: material.outlineGeneratedAt || null,
  editedAt: material.outlineEditedAt || null,
  stale: false,
});

/** Read the stored outline. Never generates, never calls the LLM. */
const getOutline = async (sourceId) => {
  const material = await getMaterialBySourceId(sourceId);
  if (!material || !material.outline) return null;

  const validated = validateOutline(material.outline, CAPS);
  if (!validated.ok) {
    console.warn(
      `⚠️ Stored outline for ${sourceId} is malformed (${validated.error}); reporting as absent.`
    );
    return null;
  }

  const template = await resolvePromptTemplate(material.courseId);
  return {
    ...present(material, validated.outline),
    stale: isStale(material, promptHashFor(template)),
  };
};

/** Summarize one batch of material text into an outline. */
const summarizeBatch = async (template, content) => {
  const { content: raw } = await generateStructured({
    prompt: template.replace('{materialContent}', () => content),
    schema: MATERIAL_OUTLINE_SCHEMA,
    temperature: 0.2,
    schemaName: 'material_outline',
  });
  if (!raw) throw new Error('Empty response from the summarization model.');
  return JSON.parse(raw);
};

/** Generate and store an outline, replacing whatever was there. */
const generateOutline = async (sourceId) => {
  const material = await getMaterialBySourceId(sourceId);
  if (!material || !material.fileContent || !material.fileContent.trim()) {
    throw new EmptyMaterialError(sourceId);
  }

  const template = await resolvePromptTemplate(material.courseId);
  const { batches, totalChars, coveredChars, truncated } = batchContent(
    material.fileContent,
    { batchChars: OUTLINE_BATCH_CHARS, maxBatches: OUTLINE_MAX_BATCHES }
  );

  const fitsOneCall =
    material.fileContent.length <= OUTLINE_DIRECT_MAX_CHARS || batches.length === 1;
  if (!fitsOneCall) {
    throw new Error('Multi-batch summarization is not implemented yet.');
  }

  const raw = await summarizeBatch(template, batches[0]);

  const notes = [raw.notes || '', truncated ? truncationNote(coveredChars, totalChars) : '']
    .filter(Boolean)
    .join(' ');

  const validated = validateOutline({ ...raw, notes }, CAPS);
  if (!validated.ok) {
    throw new Error(`Generated outline was invalid: ${validated.error}`);
  }

  const fields = {
    outline: validated.outline,
    outlineGeneratedAt: new Date(),
    outlineModel: getLLMModel(),
    outlinePromptHash: promptHashFor(template),
    outlineSource: 'generated',
    outlineEditedAt: null,
  };
  await setMaterialOutline(sourceId, fields);

  return {
    outline: validated.outline,
    source: 'generated',
    generatedAt: fields.outlineGeneratedAt,
    editedAt: null,
    stale: false,
  };
};

module.exports = {
  getOutline,
  generateOutline,
  promptHashFor,
  EmptyMaterialError,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/material-outline.service.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/material-outline.js tests/unit/material-outline.service.test.js
git commit -m "Add getOutline and single-call generateOutline

Read and generate are separate functions on purpose: a get-or-create would let
any caller trigger a multi-second LLM call by accident, which is how
summarization ends up inside an instructor's objective-generation click.
getOutline is asserted never to invoke the model."
```

---

### Task 4: Map-reduce summarization for large materials

Replaces the `Multi-batch summarization is not implemented yet.` throw from Task 3.

**Files:**
- Modify: `src/services/material-outline.js` (`generateOutline`, plus a `consolidateOutlines` helper)
- Test: `tests/unit/material-outline.service.test.js` (extend)

**Interfaces:**
- Consumes: everything Task 3 produced.
- Produces: no new exports. `generateOutline` now handles content of any size, capped at `OUTLINE_MAX_BATCHES` batches.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/material-outline.service.test.js`:

```js
describe('generateOutline with large materials', () => {
  const BIG = 'x'.repeat(250000); // > OUTLINE_DIRECT_MAX_CHARS (100000)

  it('summarizes in batches and consolidates once', async () => {
    materialService.getMaterialBySourceId.mockResolvedValue(
      storedMaterial({ fileContent: BIG, outline: undefined })
    );
    mockGenerateStructured.mockResolvedValue({
      content: JSON.stringify(OUTLINE),
      usage: {},
    });

    await generateOutline('src-1');

    // 250000 chars / 80000 per batch = 4 batches, plus one consolidation call.
    expect(mockGenerateStructured).toHaveBeenCalledTimes(5);

    const consolidationPrompt =
      mockGenerateStructured.mock.calls[4][0].prompt;
    expect(consolidationPrompt).toContain('Topic A');
  });

  it('records truncation in notes when coverage is capped', async () => {
    const huge = 'y'.repeat(80000 * 12); // 12 batches, cap is 8
    materialService.getMaterialBySourceId.mockResolvedValue(
      storedMaterial({ fileContent: huge, outline: undefined })
    );

    await generateOutline('src-1');

    const stored = materialService.setMaterialOutline.mock.calls[0][1].outline;
    expect(stored.notes).toContain(String(80000 * 8));
    expect(stored.notes).toContain(String(80000 * 12));
  });

  it('does not append a truncation note when everything was covered', async () => {
    materialService.getMaterialBySourceId.mockResolvedValue(
      storedMaterial({ fileContent: BIG, outline: undefined })
    );

    await generateOutline('src-1');

    const stored = materialService.setMaterialOutline.mock.calls[0][1].outline;
    expect(stored.notes).not.toContain('were not summarized');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/material-outline.service.test.js -t "large materials"`

Expected: FAIL with `Multi-batch summarization is not implemented yet.`

- [ ] **Step 3: Write the implementation**

In `src/services/material-outline.js`, add a consolidation prompt constant near the top:

```js
/**
 * Merges per-batch outlines into one. Kept local rather than instructor-editable:
 * it is a mechanical merge step, not a summarization style choice.
 */
const CONSOLIDATION_PROMPT = `You are merging several partial outlines of the same course material into one coherent outline.

PARTIAL OUTLINES:
{partialOutlines}

INSTRUCTIONS:
1. Combine topics that describe the same subject into a single topic, merging their key points.
2. Keep the order in which the topics first appear.
3. Do not invent topics or key points that are not in the partial outlines.
4. Leave notes as an empty string unless a partial outline reported a caveat worth keeping.`;
```

Add the helper:

```js
/** Merge per-batch outlines into one via a single consolidation call. */
const consolidateOutlines = async (partials) => {
  const rendered = partials
    .map((partial, index) => `Partial outline ${index + 1}:\n${JSON.stringify(partial)}`)
    .join('\n\n');

  const { content: raw } = await generateStructured({
    prompt: CONSOLIDATION_PROMPT.replace('{partialOutlines}', () => rendered),
    schema: MATERIAL_OUTLINE_SCHEMA,
    temperature: 0.2,
    schemaName: 'material_outline',
  });
  if (!raw) throw new Error('Empty response from the consolidation model.');
  return JSON.parse(raw);
};
```

Then replace the `fitsOneCall` block in `generateOutline` with:

```js
  // One call when the material fits; otherwise summarize each batch and merge.
  // Each batch is a separate call, so a long document costs batches + 1.
  let raw;
  if (batches.length === 1) {
    raw = await summarizeBatch(template, batches[0]);
  } else {
    const partials = [];
    for (const batch of batches) {
      partials.push(await summarizeBatch(template, batch));
    }
    raw = await consolidateOutlines(partials);
  }
```

Delete the now-unused `fitsOneCall` variable and the `OUTLINE_DIRECT_MAX_CHARS` import if nothing else uses it — batching already yields exactly one batch for content at or below the direct threshold, so the constant is only a documented ceiling.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/material-outline.service.test.js`

Expected: PASS, including the Task 3 cases.

- [ ] **Step 5: Commit**

```bash
git add src/services/material-outline.js tests/unit/material-outline.service.test.js
git commit -m "Summarize oversized materials by map-reduce

Batches are summarized sequentially and merged by one consolidation call, so a
long document costs batches + 1 requests. Coverage stops at OUTLINE_MAX_BATCHES
and the cap is recorded in notes by code rather than asked of the model."
```

---

### Task 5: `saveOutline` for instructor edits

**Files:**
- Modify: `src/services/material-outline.js` (add `saveOutline`, `NoOutlineError`, `InvalidOutlineError`, export them)
- Test: `tests/unit/material-outline.service.test.js` (extend)

**Interfaces:**
- Consumes: `validateOutline`, `getMaterialBySourceId`, `setMaterialOutline`.
- Produces: `saveOutline(sourceId, outline)` → `{ outline, source: 'edited', generatedAt, editedAt, stale: false }`; `NoOutlineError` with `code === 'NO_OUTLINE'`; `InvalidOutlineError` with `code === 'INVALID_OUTLINE'` and a human-readable `message`.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/material-outline.service.test.js`, and add `saveOutline`, `NoOutlineError`, `InvalidOutlineError` to the existing `require` of the service at the top of the file:

```js
describe('saveOutline', () => {
  const edited = {
    topics: [{ title: 'Corrected topic', keyPoints: ['Instructor point'] }],
    notes: 'this should be ignored',
  };

  it('stores the edit and marks provenance', async () => {
    materialService.getMaterialBySourceId.mockResolvedValue(
      storedMaterial({ outline: { ...OUTLINE, notes: 'model caveat' } })
    );

    const result = await saveOutline('src-1', edited);

    expect(result.source).toBe('edited');
    expect(result.stale).toBe(false);

    const [, fields] = materialService.setMaterialOutline.mock.calls[0];
    expect(fields.outlineSource).toBe('edited');
    expect(fields.outlineEditedAt).toBeInstanceOf(Date);
    expect(fields.outline.topics[0].title).toBe('Corrected topic');
  });

  // notes carries model caveats and the code-generated truncation sentence, so
  // it is state about how the outline was produced, not instructor content.
  it('keeps the stored notes and ignores caller-supplied notes', async () => {
    materialService.getMaterialBySourceId.mockResolvedValue(
      storedMaterial({ outline: { ...OUTLINE, notes: 'model caveat' } })
    );

    await saveOutline('src-1', edited);

    const [, fields] = materialService.setMaterialOutline.mock.calls[0];
    expect(fields.outline.notes).toBe('model caveat');
  });

  it('does not let a caller overwrite generation provenance', async () => {
    materialService.getMaterialBySourceId.mockResolvedValue(storedMaterial());

    await saveOutline('src-1', {
      ...edited,
      outlineModel: 'attacker-model',
      outlinePromptHash: 'attackerhash000',
    });

    const [, fields] = materialService.setMaterialOutline.mock.calls[0];
    expect(fields.outlineModel).toBeUndefined();
    expect(fields.outlinePromptHash).toBeUndefined();
  });

  it('rejects an edit when the material has no outline yet', async () => {
    materialService.getMaterialBySourceId.mockResolvedValue(
      storedMaterial({ outline: undefined })
    );

    await expect(saveOutline('src-1', edited)).rejects.toMatchObject({
      code: 'NO_OUTLINE',
    });
    expect(materialService.setMaterialOutline).not.toHaveBeenCalled();
  });

  it('rejects an invalid edit with a usable message', async () => {
    materialService.getMaterialBySourceId.mockResolvedValue(storedMaterial());

    await expect(saveOutline('src-1', { topics: [], notes: '' })).rejects.toMatchObject({
      code: 'INVALID_OUTLINE',
    });
    expect(materialService.setMaterialOutline).not.toHaveBeenCalled();
  });

  it('rejects an edit that exceeds the size cap', async () => {
    materialService.getMaterialBySourceId.mockResolvedValue(storedMaterial());
    const bloated = {
      topics: [{ title: 'T', keyPoints: ['z'.repeat(30000)] }],
      notes: '',
    };

    await expect(saveOutline('src-1', bloated)).rejects.toMatchObject({
      code: 'INVALID_OUTLINE',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/material-outline.service.test.js -t saveOutline`

Expected: FAIL — `saveOutline` is not a function.

- [ ] **Step 3: Write the implementation**

In `src/services/material-outline.js`, add the two error classes beside `EmptyMaterialError`:

```js
/** Thrown when an edit is attempted on a material that has no outline. */
class NoOutlineError extends Error {
  constructor(sourceId) {
    super(`Material ${sourceId} has no outline to edit; generate one first.`);
    this.name = 'NoOutlineError';
    this.code = 'NO_OUTLINE';
  }
}

/** Thrown when a submitted outline fails validation. */
class InvalidOutlineError extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'InvalidOutlineError';
    this.code = 'INVALID_OUTLINE';
  }
}
```

Add the function, and add all three names to `module.exports`:

```js
/**
 * Store an instructor's edit. The edit wins until an explicit regeneration —
 * there is no merging with model output, which is what would demand versioning
 * and conflict rules.
 *
 * `notes` and the generation provenance fields are deliberately not writable
 * here: they describe how the outline was produced, not what the instructor
 * authored.
 */
const saveOutline = async (sourceId, submitted) => {
  const material = await getMaterialBySourceId(sourceId);
  if (!material || !material.outline) {
    throw new NoOutlineError(sourceId);
  }

  const validated = validateOutline(submitted, CAPS);
  if (!validated.ok) {
    throw new InvalidOutlineError(validated.error);
  }

  const fields = {
    outline: { topics: validated.outline.topics, notes: material.outline.notes || '' },
    outlineSource: 'edited',
    outlineEditedAt: new Date(),
  };
  await setMaterialOutline(sourceId, fields);

  return {
    outline: fields.outline,
    source: 'edited',
    generatedAt: material.outlineGeneratedAt || null,
    editedAt: fields.outlineEditedAt,
    stale: false,
  };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/material-outline.service.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/material-outline.js tests/unit/material-outline.service.test.js
git commit -m "Let instructors save an edited outline

The edit wins until an explicit regeneration, so no merging, versioning, or
conflict rules are needed. notes and the generation provenance fields are not
writable through this path: they record how the outline was produced, not what
the instructor wrote."
```

---

### Task 6: Routes and controllers

**Files:**
- Modify: `src/controllers/material.js` (add three handlers; add `hasOutline` to the list; export the handlers)
- Modify: `src/routes/material.js` (add three routes)
- Test: `tests/unit/material-outline.route.test.js`

**Interfaces:**
- Consumes: `getOutline`, `generateOutline`, `saveOutline`, `EmptyMaterialError`/`NoOutlineError`/`InvalidOutlineError` codes from `src/services/material-outline.js`; `getMaterialCourseId`, `getCourseMaterials` from `src/services/material.js`; `hasStaffAccessInCourse`, `assertCoInstructorPermission`, `assertTaPermission` already imported in the controller.
- Produces:
  - `GET /api/material/:sourceId/outline` → `200 { success: true, ...outlineShape }` or `404 { success: false }`
  - `POST /api/material/:sourceId/outline` → `200 { success: true, ...outlineShape }`, `400` on `EMPTY_MATERIAL`
  - `PUT /api/material/:sourceId/outline` → `200 { success: true, ...outlineShape }`, `400` on `NO_OUTLINE` / `INVALID_OUTLINE`
  - `GET /api/material/course/:courseId` materials each gain `hasOutline: boolean` and never carry `outline`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/material-outline.route.test.js`:

```js
jest.mock('../../src/services/material-outline', () => ({
  getOutline: jest.fn(),
  generateOutline: jest.fn(),
  saveOutline: jest.fn(),
}));
jest.mock('../../src/services/material', () => ({
  saveMaterial: jest.fn(),
  getCourseMaterials: jest.fn(),
  getMaterialCourseId: jest.fn().mockResolvedValue('course-1'),
  deleteMaterial: jest.fn(),
  getMaterialBySourceId: jest.fn(),
  setMaterialOutline: jest.fn(),
  clearMaterialOutline: jest.fn(),
}));
jest.mock('../../src/utils/course-access', () => ({
  hasStaffAccessInCourse: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../src/utils/co-instructor-permissions', () => ({
  assertCoInstructorPermission: jest.fn().mockResolvedValue(true),
  PERMISSION_KEYS: { QUESTION_GENERATION: 'questionGeneration' },
}));
jest.mock('../../src/utils/ta-permissions', () => ({
  assertTaPermission: jest.fn().mockResolvedValue(true),
  TA_PERMISSION_KEYS: { QUESTION_GENERATION: 'questionGeneration' },
}));
jest.mock('../../src/services/course', () => ({ getCourseById: jest.fn() }));
jest.mock('../../src/services/settings', () => ({ getSettings: jest.fn() }));
jest.mock('../../src/services/rag', () => ({
  addDocumentToRAG: jest.fn(),
  deleteDocumentFromRAG: jest.fn(),
}));
jest.mock('../../src/services/database', () => ({ connect: jest.fn() }));
jest.mock('../../src/utils/parse-in-worker', () => ({ parseInWorker: jest.fn() }));

const outlineService = require('../../src/services/material-outline');
const materialService = require('../../src/services/material');
const courseAccess = require('../../src/utils/course-access');
const {
  getMaterialOutlineHandler,
  generateMaterialOutlineHandler,
  saveMaterialOutlineHandler,
  getCourseMaterialsHandler,
} = require('../../src/controllers/material');

const RESULT = {
  outline: { topics: [{ title: 'T', keyPoints: ['p'] }], notes: '' },
  source: 'generated',
  generatedAt: new Date('2026-08-01'),
  editedAt: null,
  stale: false,
};

const buildRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};
const buildReq = (overrides = {}) => ({
  params: { sourceId: 'src-1' },
  user: { id: 'user-1' },
  body: {},
  ...overrides,
});

describe('GET outline', () => {
  it('returns the stored outline', async () => {
    outlineService.getOutline.mockResolvedValue(RESULT);
    const res = buildRes();

    await getMaterialOutlineHandler(buildReq(), res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, source: 'generated' })
    );
  });

  it('404s when there is no outline', async () => {
    outlineService.getOutline.mockResolvedValue(null);
    const res = buildRes();

    await getMaterialOutlineHandler(buildReq(), res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('403s without staff access', async () => {
    courseAccess.hasStaffAccessInCourse.mockResolvedValueOnce(false);
    const res = buildRes();

    await getMaterialOutlineHandler(buildReq(), res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(outlineService.getOutline).not.toHaveBeenCalled();
  });
});

describe('POST outline', () => {
  it('generates and returns the outline', async () => {
    outlineService.generateOutline.mockResolvedValue(RESULT);
    const res = buildRes();

    await generateMaterialOutlineHandler(buildReq(), res);

    expect(outlineService.generateOutline).toHaveBeenCalledWith('src-1');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('400s when the material has no text', async () => {
    outlineService.generateOutline.mockRejectedValue(
      Object.assign(new Error('nothing to summarize'), { code: 'EMPTY_MATERIAL' })
    );
    const res = buildRes();

    await generateMaterialOutlineHandler(buildReq(), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'EMPTY_MATERIAL' })
    );
  });

  it('403s without staff access', async () => {
    courseAccess.hasStaffAccessInCourse.mockResolvedValueOnce(false);
    const res = buildRes();

    await generateMaterialOutlineHandler(buildReq(), res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(outlineService.generateOutline).not.toHaveBeenCalled();
  });
});

describe('PUT outline', () => {
  it('saves a valid edit', async () => {
    outlineService.saveOutline.mockResolvedValue({ ...RESULT, source: 'edited' });
    const res = buildRes();
    const req = buildReq({ body: { outline: RESULT.outline } });

    await saveMaterialOutlineHandler(req, res);

    expect(outlineService.saveOutline).toHaveBeenCalledWith('src-1', RESULT.outline);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, source: 'edited' })
    );
  });

  it('400s on an invalid edit, surfacing the reason', async () => {
    outlineService.saveOutline.mockRejectedValue(
      Object.assign(new Error('An outline needs at least one topic.'), {
        code: 'INVALID_OUTLINE',
      })
    );
    const res = buildRes();

    await saveMaterialOutlineHandler(buildReq({ body: { outline: {} } }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'INVALID_OUTLINE',
        error: 'An outline needs at least one topic.',
      })
    );
  });

  it('400s when there is no outline to edit', async () => {
    outlineService.saveOutline.mockRejectedValue(
      Object.assign(new Error('generate one first'), { code: 'NO_OUTLINE' })
    );
    const res = buildRes();

    await saveMaterialOutlineHandler(buildReq({ body: { outline: {} } }), res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('400s when no outline is supplied at all', async () => {
    const res = buildRes();

    await saveMaterialOutlineHandler(buildReq({ body: {} }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(outlineService.saveOutline).not.toHaveBeenCalled();
  });
});

describe('materials list', () => {
  // The list is already oversized; shipping every topic list to render a button
  // would repeat that mistake.
  it('reports hasOutline and never includes the outline itself', async () => {
    materialService.getCourseMaterials.mockResolvedValue([
      { sourceId: 'a', outline: { topics: [], notes: '' }, outlineSource: 'edited' },
      { sourceId: 'b' },
    ]);
    const res = buildRes();

    await getCourseMaterialsHandler(
      { params: { courseId: 'course-1' }, user: { id: 'u' } },
      res
    );

    const { materials } = res.json.mock.calls[0][0];
    expect(materials[0].hasOutline).toBe(true);
    expect(materials[0].outlineSource).toBe('edited');
    expect(materials[0].outline).toBeUndefined();
    expect(materials[1].hasOutline).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/material-outline.route.test.js`

Expected: FAIL — `getMaterialOutlineHandler` is not a function.

- [ ] **Step 3: Add the handlers**

In `src/controllers/material.js`, add the service import at the top:

```js
const outlineService = require('../services/material-outline');
```

Add the three handlers before `module.exports`, and add all three names to the exports:

```js
/** Shared gate for the outline routes: staff access plus generation permissions. */
const assertOutlineAccess = async (req, res) => {
    const courseId = await getMaterialCourseId(req.params.sourceId);
    if (!(await hasStaffAccessInCourse(req.user, courseId))) {
        res.status(403).json({ success: false, error: "User is not in course" });
        return null;
    }
    if (!(await assertCoInstructorPermission(req, res, courseId, PERMISSION_KEYS.QUESTION_GENERATION))) return null;
    if (!(await assertTaPermission(req, res, courseId, TA_PERMISSION_KEYS.QUESTION_GENERATION))) return null;
    return { courseId };
};

const getMaterialOutlineHandler = async (req, res) => {
    try {
        if (!(await assertOutlineAccess(req, res))) return;

        const result = await outlineService.getOutline(req.params.sourceId);
        if (!result) {
            return res.status(404).json({ success: false, error: "No outline for this material" });
        }
        res.json({ success: true, ...result });
    } catch (error) {
        console.error("Error fetching material outline:", error);
        res.status(500).json({ success: false, error: "Failed to fetch outline" });
    }
};

const generateMaterialOutlineHandler = async (req, res) => {
    try {
        if (!(await assertOutlineAccess(req, res))) return;

        const result = await outlineService.generateOutline(req.params.sourceId);
        res.json({ success: true, ...result });
    } catch (error) {
        if (error.code === 'EMPTY_MATERIAL') {
            return res.status(400).json({ success: false, code: error.code, error: error.message });
        }
        console.error("Error generating material outline:", error);
        res.status(500).json({ success: false, error: "Failed to generate outline" });
    }
};

const saveMaterialOutlineHandler = async (req, res) => {
    try {
        if (!(await assertOutlineAccess(req, res))) return;

        const { outline } = req.body;
        if (!outline) {
            return res.status(400).json({ success: false, error: "An outline is required" });
        }

        const result = await outlineService.saveOutline(req.params.sourceId, outline);
        res.json({ success: true, ...result });
    } catch (error) {
        if (error.code === 'NO_OUTLINE' || error.code === 'INVALID_OUTLINE') {
            return res.status(400).json({ success: false, code: error.code, error: error.message });
        }
        console.error("Error saving material outline:", error);
        res.status(500).json({ success: false, error: "Failed to save outline" });
    }
};
```

- [ ] **Step 4: Add `hasOutline` to the list**

In `src/controllers/material.js`, replace the response line in `getCourseMaterialsHandler`:

```js
        const materials = await getCourseMaterials(courseId);
        // The outline itself is never listed — it is fetched per material when
        // the instructor opens it. Only whether one exists is needed here.
        const summarized = materials.map(({ outline, ...rest }) => ({
            ...rest,
            hasOutline: !!outline,
        }));
        res.json({ success: true, materials: summarized });
```

- [ ] **Step 5: Add the routes**

In `src/routes/material.js`, add before `module.exports`:

```js
router.get("/:sourceId/outline", materialController.getMaterialOutlineHandler);

router.post("/:sourceId/outline", materialController.generateMaterialOutlineHandler);

router.put("/:sourceId/outline", largeJson, materialController.saveMaterialOutlineHandler);
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx jest tests/unit/material-outline.route.test.js && npm run test:unit`

Expected: both PASS. The new route is registered after `/course/:courseId`, so confirm no existing material route test regresses.

- [ ] **Step 7: Commit**

```bash
git add src/controllers/material.js src/routes/material.js tests/unit/material-outline.route.test.js
git commit -m "Add outline routes and report hasOutline in the materials list

GET, POST, and PUT for a material's outline, all gated like other generation
endpoints. The list reports only whether an outline exists: it is already an
oversized payload, and shipping every topic list to render a button would make
that worse."
```

---

### Task 7: Generate at upload, clear on content change

**Files:**
- Modify: `src/controllers/material.js` (`uploadFileHandler` best-effort generation; `updateMaterialHandler` clears the outline)
- Test: `tests/unit/material-outline-lifecycle.controller.test.js`

**Interfaces:**
- Consumes: `outlineService.generateOutline` and `clearMaterialOutline` from Tasks 3 and 2.
- Produces: no new exports.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/material-outline-lifecycle.controller.test.js`:

```js
jest.mock('../../src/services/material-outline', () => ({
  getOutline: jest.fn(),
  generateOutline: jest.fn(),
  saveOutline: jest.fn(),
}));
jest.mock('../../src/services/material', () => ({
  saveMaterial: jest.fn(),
  getCourseMaterials: jest.fn(),
  getMaterialCourseId: jest.fn().mockResolvedValue('course-1'),
  deleteMaterial: jest.fn(),
  getMaterialBySourceId: jest.fn(),
  setMaterialOutline: jest.fn(),
  clearMaterialOutline: jest.fn(),
}));
jest.mock('../../src/utils/course-access', () => ({
  hasStaffAccessInCourse: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../src/utils/co-instructor-permissions', () => ({
  assertCoInstructorPermission: jest.fn().mockResolvedValue(true),
  PERMISSION_KEYS: { QUESTION_GENERATION: 'questionGeneration' },
}));
jest.mock('../../src/utils/ta-permissions', () => ({
  assertTaPermission: jest.fn().mockResolvedValue(true),
  TA_PERMISSION_KEYS: { QUESTION_GENERATION: 'questionGeneration' },
}));
jest.mock('../../src/services/course', () => ({
  getCourseById: jest.fn().mockResolvedValue({ courseName: 'Biology' }),
}));
jest.mock('../../src/services/settings', () => ({
  getSettings: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../src/services/rag', () => ({
  addDocumentToRAG: jest.fn().mockResolvedValue(['chunk-1']),
  deleteDocumentFromRAG: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../src/services/database', () => ({ connect: jest.fn() }));
jest.mock('../../src/utils/parse-in-worker', () => ({
  parseInWorker: jest.fn().mockResolvedValue({ content: 'Parsed text.', tokenUsage: 0 }),
}));

const outlineService = require('../../src/services/material-outline');
const materialService = require('../../src/services/material');
const { uploadFileHandler } = require('../../src/controllers/material');

const buildRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

const buildUploadReq = () => ({
  user: { id: 'user-1' },
  body: { courseId: 'course-1', documentTitle: 'Lecture 3' },
  file: {
    originalname: 'lecture.txt',
    mimetype: 'text/plain',
    buffer: Buffer.from('Some teachable content.'),
    size: 23,
  },
});

describe('outline generation at upload', () => {
  it('generates an outline after the material is stored', async () => {
    outlineService.generateOutline.mockResolvedValue({ outline: { topics: [], notes: '' } });
    const res = buildRes();

    await uploadFileHandler(buildUploadReq(), res);

    expect(materialService.saveMaterial).toHaveBeenCalled();
    expect(outlineService.generateOutline).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  // Losing a parsed and stored material because its summary failed would be a
  // bad trade; the instructor can generate it from the materials page instead.
  it('still succeeds when outline generation fails', async () => {
    outlineService.generateOutline.mockRejectedValue(new Error('model unavailable'));
    const res = buildRes();

    await uploadFileHandler(buildUploadReq(), res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    expect(res.status).not.toHaveBeenCalledWith(500);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/material-outline-lifecycle.controller.test.js`

Expected: FAIL — `generateOutline` is never called, so the first assertion fails with 0 calls.

- [ ] **Step 3: Generate at upload, guarded**

In `src/controllers/material.js`, in `uploadFileHandler`, immediately after the `await saveMaterial(...)` call and before `res.json(...)`, add:

```js
        // Best-effort: the upload path already tolerates long work (OCR, and a
        // vision call per slide for PPTX), so this is the right place to spend
        // it. But a failed summary must never cost a material that parsed and
        // stored fine — the instructor can generate it from the materials page.
        try {
            await outlineService.generateOutline(actualSourceId);
        } catch (outlineError) {
            console.warn(
                `⚠️ Could not generate an outline for ${actualSourceId}:`,
                outlineError.message
            );
        }
```

- [ ] **Step 4: Clear the outline when content changes**

In `src/controllers/material.js`, in `updateMaterialHandler`, inside the existing `if (!TITLE_ONLY_UPDATE_TYPES.has(documentType)) { ... }` block that deletes and re-adds the RAG document, add after the re-add:

```js
            // The stored outline described text that no longer exists. This
            // discards instructor edits too, which the edit UI warns about.
            await clearMaterialOutline(sourceId);
```

Add `clearMaterialOutline` to the existing destructured `require` of `../services/material` at the top of the file.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest tests/unit/material-outline-lifecycle.controller.test.js && npm run test:unit`

Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add src/controllers/material.js tests/unit/material-outline-lifecycle.controller.test.js
git commit -m "Generate outlines at upload and clear them on content change

Upload summarizes best-effort: that path already tolerates OCR and per-slide
vision calls, but a failed summary must not cost a material that stored fine.
A content change clears the outline, instructor edits included, because it
described text that no longer exists."
```

---

### Task 8: Objective generation reads outlines, falls back to RAG

**Files:**
- Modify: `src/controllers/rag-llm.js` (`generateLearningObjectivesHandler`)
- Modify: `.env.example` (note `RAG_OBJECTIVE_CHUNK_LIMIT` is fallback-only)
- Test: `tests/unit/objective-generation-prompt.controller.test.js` (extend)

**Interfaces:**
- Consumes: `getOutline` from `src/services/material-outline.js`; `renderOutlineBlock` from `src/utils/outline-text.js`; `getMaterialBySourceId` from `src/services/material.js`.
- Produces: no new exports. `generateLearningObjectivesHandler` prefers outlines and never generates one.

- [ ] **Step 1: Write the failing test**

Add to the top mock block of `tests/unit/objective-generation-prompt.controller.test.js`:

```js
jest.mock('../../src/services/material-outline', () => ({
  getOutline: jest.fn(),
  generateOutline: jest.fn(),
}));
jest.mock('../../src/services/material', () => ({
  getMaterialBySourceId: jest.fn(),
  getMaterialCourseId: jest.fn(),
}));
```

and after the existing requires:

```js
const outlineService = require('../../src/services/material-outline');
const materialService = require('../../src/services/material');
```

Then append:

```js
describe('objective generation from outlines', () => {
  const outlineFor = (title) => ({
    outline: { topics: [{ title, keyPoints: [`${title} point`] }], notes: '' },
    source: 'generated',
    generatedAt: new Date(),
    editedAt: null,
    stale: false,
  });

  beforeEach(() => {
    mockGenerateStructured.mockReset();
    mockGetRagContentFromMaterials.mockReset();
    mockGenerateStructured.mockResolvedValue({
      content: JSON.stringify(validObjectives),
      usage: {},
    });
    materialService.getMaterialBySourceId.mockImplementation(async (sourceId) => ({
      sourceId,
      documentTitle: `Title ${sourceId}`,
    }));
  });

  it('builds the prompt from outlines and makes no RAG call', async () => {
    outlineService.getOutline.mockImplementation(async (sourceId) =>
      outlineFor(`Topic ${sourceId}`)
    );

    await generateLearningObjectivesHandler(buildRequest(), buildResponse());

    expect(mockGetRagContentFromMaterials).not.toHaveBeenCalled();
    const prompt = promptFromFirstCall();
    expect(prompt).toContain('### MATERIAL: Title material-a (SOURCE ID: material-a)');
    expect(prompt).toContain('### MATERIAL: Title material-b (SOURCE ID: material-b)');
    expect(prompt).toContain('## Topic material-a');
    expect(prompt).toContain('\n\n---\n\n');
  });

  // Generating here is what would make every instructor's first objective
  // generation on every pre-existing material the slow one.
  it('never generates an outline', async () => {
    outlineService.getOutline.mockResolvedValue(null);
    mockGetRagContentFromMaterials.mockResolvedValue('Retrieved chunk text.');

    await generateLearningObjectivesHandler(buildRequest(), buildResponse());

    expect(outlineService.generateOutline).not.toHaveBeenCalled();
  });

  it('falls back to retrieval when any outline is missing', async () => {
    outlineService.getOutline.mockImplementation(async (sourceId) =>
      sourceId === 'material-a' ? outlineFor('Topic A') : null
    );
    mockGetRagContentFromMaterials.mockResolvedValue('Retrieved chunk text.');

    await generateLearningObjectivesHandler(buildRequest(), buildResponse());

    expect(mockGetRagContentFromMaterials).toHaveBeenCalledTimes(1);
    expect(promptFromFirstCall()).toContain('Retrieved chunk text.');
  });

  it('falls back to retrieval when reading an outline throws', async () => {
    outlineService.getOutline.mockRejectedValue(new Error('mongo down'));
    mockGetRagContentFromMaterials.mockResolvedValue('Retrieved chunk text.');

    await generateLearningObjectivesHandler(buildRequest(), buildResponse());

    expect(promptFromFirstCall()).toContain('Retrieved chunk text.');
  });

  it('still carries the sourceIds the auto prompt expects', async () => {
    outlineService.getOutline.mockImplementation(async (sourceId) =>
      outlineFor(`Topic ${sourceId}`)
    );

    await generateLearningObjectivesHandler(buildRequest(), buildResponse());

    expect(promptFromFirstCall()).toContain('material-a, material-b');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/objective-generation-prompt.controller.test.js -t "from outlines"`

Expected: FAIL — a RAG call is still made and no `### MATERIAL: Title material-a` header appears.

- [ ] **Step 3: Write the implementation**

In `src/controllers/rag-llm.js`, add the imports:

```js
const outlineService = require('../services/material-outline');
const { renderOutlineBlock } = require('../utils/outline-text');
const { getMaterialBySourceId } = require('../services/material');
```

In `generateLearningObjectivesHandler`, replace the retrieval block (the `objectiveRagLimit` declaration and the `getRagContentFromMaterials` call that assigns `ragContext`) with:

```js
    // Objective generation is a coverage task, so it reads each material's
    // stored outline rather than a similarity ranking. It never generates one:
    // doing so here would put a multi-second summarization inside this click
    // for every material that does not have one yet.
    let ragContext = '';
    let usedOutlines = false;
    try {
      const blocks = [];
      for (const sourceId of materialIds) {
        const stored = await outlineService.getOutline(sourceId);
        if (!stored) {
          blocks.length = 0;
          break;
        }
        const material = await getMaterialBySourceId(sourceId);
        blocks.push(
          renderOutlineBlock({
            documentTitle: material?.documentTitle || '',
            sourceId,
            outline: stored.outline,
          })
        );
      }
      if (blocks.length === materialIds.length && blocks.length > 0) {
        ragContext = blocks.join('\n\n---\n\n');
        usedOutlines = true;
      }
    } catch (outlineError) {
      console.warn(
        '⚠️ Could not read material outlines; falling back to retrieval:',
        outlineError.message
      );
    }

    if (!usedOutlines) {
      // Exactly today's behaviour, so a material without an outline generates
      // objectives no worse than it does now.
      const objectiveRagLimit = parseInt(process.env.RAG_OBJECTIVE_CHUNK_LIMIT) || 200;
      console.log('Retrieving RAG content from selected materials (outline fallback)...');
      ragContext = await ragService.getRagContentFromMaterials(
        materialIds,
        searchQuery,
        objectiveRagLimit,
        courseId
      );
    }
```

Leave the existing empty-context checks, the `OBJECTIVE_CONTEXT_WARN_CHARS` warning, and both prompt branches unchanged.

- [ ] **Step 4: Update `.env.example`**

Change the `RAG_OBJECTIVE_CHUNK_LIMIT` comment block to:

```
# Objective generation FALLBACK only. Objective generation normally reads each
# material's stored outline; this budget applies when a selected material has no
# outline yet. Chunks are capped at 1000 chars each, so 200 tops out near 200k
# chars. Objective generation applies no score threshold.
RAG_OBJECTIVE_CHUNK_LIMIT=200
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest tests/unit/objective-generation-prompt.controller.test.js && npm run test:unit`

Expected: both PASS. The pre-existing tests in that file assert LaTeX interpolation and the absence of truncation; they must still pass because the fallback path is unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/controllers/rag-llm.js .env.example tests/unit/objective-generation-prompt.controller.test.js
git commit -m "Build objective prompts from material outlines

Objective generation is a coverage task, so it reads each selected material's
stored outline instead of 200 similarity-ranked chunks. It never generates one:
summarizing here would make every instructor's first generation on every
pre-existing material the slow one.

Any missing outline sends the whole request down the existing retrieval path,
which is unchanged, so nothing regresses."
```

---

### Task 9: Materials page — view, edit, regenerate

**Files:**
- Modify: `client/src/hooks/useMaterials.js` (outline query and mutations)
- Create: `client/src/pages/course-materials/OutlineModal.jsx`
- Modify: `client/src/pages/course-materials/MaterialCard.jsx` (outline button and flag)
- Modify: `client/src/pages/CourseMaterials.jsx` (wire the modal)
- Modify: `client/src/lib/queryKeys.js` (outline key)

**Interfaces:**
- Consumes: `GET/POST/PUT /api/material/:sourceId/outline` and the `hasOutline` field from Task 6.
- Produces: no server interfaces.

- [ ] **Step 1: Add the query key**

In `client/src/lib/queryKeys.js`, add to the exported object, matching the existing style:

```js
  materialOutline: (sourceId) => ["material-outline", sourceId],
```

- [ ] **Step 2: Add the hooks**

In `client/src/hooks/useMaterials.js`, append:

```js
export function useMaterialOutline(sourceId, enabled) {
  const query = useQuery({
    queryKey: queryKeys.materialOutline(sourceId),
    queryFn: () => api.get(`/api/material/${sourceId}/outline`),
    enabled: !!sourceId && !!enabled,
    retry: false, // a 404 means "no outline yet", not a transient failure
  });
  return { ...query, outlineData: query.data || null };
}

export function useGenerateOutline(courseId, options) {
  const queryClient = useQueryClient();
  const invalidateMaterials = useInvalidateMaterials(courseId);
  return useMutation({
    mutationFn: (sourceId) => api.post(`/api/material/${sourceId}/outline`, {}),
    onSuccess: (data, sourceId) => {
      queryClient.setQueryData(queryKeys.materialOutline(sourceId), data);
      invalidateMaterials();
      options?.onSuccess?.(data, sourceId);
    },
    onError: options?.onError,
  });
}

export function useSaveOutline(courseId, options) {
  const queryClient = useQueryClient();
  const invalidateMaterials = useInvalidateMaterials(courseId);
  return useMutation({
    mutationFn: ({ sourceId, outline }) =>
      api.put(`/api/material/${sourceId}/outline`, { outline }),
    onSuccess: (data, { sourceId }) => {
      queryClient.setQueryData(queryKeys.materialOutline(sourceId), data);
      invalidateMaterials();
      options?.onSuccess?.(data, sourceId);
    },
    onError: options?.onError,
  });
}
```

- [ ] **Step 3: Create the modal**

Create `client/src/pages/course-materials/OutlineModal.jsx`:

```jsx
import { useEffect, useState } from "react";
import Modal from "../../components/ui/Modal";
import { useMaterialOutline } from "../../hooks/useMaterials";

// Read the outline a material was summarized into, and correct it. Editing is
// deterministic and free, where regenerating is neither — so an instructor who
// spots a wrong topic should fix it rather than reroll.
export default function OutlineModal({
  material,
  onClose,
  onGenerate,
  onSave,
  generating,
  saving,
}) {
  const { outlineData, isPending, isError } = useMaterialOutline(
    material?.sourceId,
    true
  );
  const [editing, setEditing] = useState(false);
  const [topics, setTopics] = useState([]);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);

  useEffect(() => {
    setTopics(outlineData?.outline?.topics || []);
    setEditing(false);
    setConfirmRegenerate(false);
  }, [outlineData]);

  const missing = isError || (!isPending && !outlineData);
  const edited = outlineData?.source === "edited";

  const updateTopic = (index, patch) =>
    setTopics((prev) => prev.map((t, i) => (i === index ? { ...t, ...patch } : t)));

  const requestRegenerate = () => {
    if (edited && !confirmRegenerate) {
      setConfirmRegenerate(true);
      return;
    }
    setConfirmRegenerate(false);
    onGenerate(material.sourceId);
  };

  return (
    <Modal
      open
      onClose={generating || saving ? () => {} : onClose}
      title={`Outline — ${material?.documentTitle || "Untitled"}`}
      wide
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={generating || saving}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-ink hover:bg-gray-50 disabled:opacity-50"
          >
            Close
          </button>
          {!missing && !editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-ink hover:bg-gray-50"
            >
              <i className="fas fa-pen mr-2" /> Edit
            </button>
          )}
          {editing && (
            <button
              type="button"
              disabled={saving}
              onClick={() => onSave({ sourceId: material.sourceId, outline: { topics } })}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save changes"}
            </button>
          )}
          <button
            type="button"
            disabled={generating}
            onClick={requestRegenerate}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark disabled:opacity-50"
          >
            {generating ? (
              <>
                <i className="fas fa-spinner fa-spin" /> Generating...
              </>
            ) : (
              <>
                <i className="fas fa-magic" /> {missing ? "Generate outline" : "Regenerate"}
              </>
            )}
          </button>
        </>
      }
    >
      {isPending && (
        <p className="py-6 text-center text-muted">
          <i className="fas fa-spinner fa-spin mr-2" /> Loading outline...
        </p>
      )}

      {missing && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          <p className="font-semibold">No outline yet</p>
          <p className="mt-1">
            Learning objectives for this material will be generated from a content
            search instead, which covers it less evenly. Generate an outline to
            improve them.
          </p>
        </div>
      )}

      {confirmRegenerate && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"
        >
          You edited this outline. Regenerating replaces it and discards your
          changes. Press Regenerate again to continue.
        </div>
      )}

      {!missing && !isPending && (
        <>
          {edited && (
            <p className="mb-3 text-xs font-semibold text-primary">
              <i className="fas fa-pen mr-1" /> Edited by an instructor
            </p>
          )}
          {outlineData?.stale && (
            <p className="mb-3 text-xs text-muted">
              Generated with an earlier model or prompt — regenerate to refresh it.
            </p>
          )}

          <div className="space-y-4">
            {topics.map((topic, index) => (
              <div key={index} className="rounded-lg border border-gray-200 p-3">
                {editing ? (
                  <input
                    type="text"
                    value={topic.title}
                    onChange={(event) => updateTopic(index, { title: event.target.value })}
                    className="mb-2 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm font-semibold focus:border-primary focus:outline-none"
                  />
                ) : (
                  <h4 className="mb-2 font-semibold text-ink">{topic.title}</h4>
                )}

                {editing ? (
                  <textarea
                    rows={Math.max(2, (topic.keyPoints || []).length)}
                    value={(topic.keyPoints || []).join("\n")}
                    onChange={(event) =>
                      updateTopic(index, {
                        keyPoints: event.target.value.split("\n").filter((line) => line.trim()),
                      })
                    }
                    className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none"
                  />
                ) : (
                  <ul className="space-y-1">
                    {(topic.keyPoints || []).map((point, pointIndex) => (
                      <li key={pointIndex} className="flex gap-2 text-sm text-gray-600">
                        <span className="text-gray-400">•</span>
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                )}

                {editing && (
                  <button
                    type="button"
                    onClick={() => setTopics((prev) => prev.filter((_, i) => i !== index))}
                    className="mt-2 text-xs text-danger underline"
                  >
                    Remove topic
                  </button>
                )}
              </div>
            ))}
          </div>

          {editing && (
            <>
              <button
                type="button"
                onClick={() => setTopics((prev) => [...prev, { title: "", keyPoints: [] }])}
                className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-primary bg-white px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/5"
              >
                <i className="fas fa-plus" /> Add topic
              </button>
              <p className="mt-3 text-xs text-muted">
                One key point per line. Outlines describe the material's current
                content — editing the material itself clears this outline.
              </p>
            </>
          )}

          {outlineData?.outline?.notes && (
            <p className="mt-4 rounded-md bg-page p-3 text-xs text-muted">
              <span className="font-semibold">Notes:</span> {outlineData.outline.notes}
            </p>
          )}
        </>
      )}
    </Modal>
  );
}
```

- [ ] **Step 4: Add the card button**

In `client/src/pages/course-materials/MaterialCard.jsx`, add `onViewOutline` to the destructured props and add a button beside the existing action buttons:

```jsx
          <button
            type="button"
            title={material.hasOutline ? "View outline" : "No outline — generate one"}
            aria-label={`Outline for ${material.documentTitle || "material"}`}
            onClick={() => onViewOutline(material)}
            className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-gray-100 ${
              material.hasOutline ? "text-muted hover:text-ink" : "text-amber-600"
            }`}
          >
            <i className={material.hasOutline ? "fas fa-list-ul" : "fas fa-triangle-exclamation"} />
          </button>
```

- [ ] **Step 5: Wire the modal**

In `client/src/pages/CourseMaterials.jsx`:

Add the imports:

```jsx
import OutlineModal from "./course-materials/OutlineModal";
import { useGenerateOutline, useSaveOutline } from "../hooks/useMaterials";
```

Add the mutations next to the existing hook calls:

```jsx
  const generateOutline = useGenerateOutline(courseId, {
    onSuccess: () => showToast("Outline generated", "success"),
    onError: (error) => showToast(error.message, "error"),
  });
  const saveOutline = useSaveOutline(courseId, {
    onSuccess: () => showToast("Outline saved", "success"),
    onError: (error) => showToast(error.message, "error"),
  });
```

Pass the handler to each card, alongside the existing props:

```jsx
              onViewOutline={(m) => setModal({ kind: "outline", material: m })}
```

Render the modal, and exclude `"outline"` from the existing form-modal condition so both don't render at once — change `{modal && modal.kind !== "delete" && (` to `{modal && modal.kind !== "delete" && modal.kind !== "outline" && (` and add:

```jsx
      {modal?.kind === "outline" && (
        <OutlineModal
          material={modal.material}
          onClose={() => setModal(null)}
          onGenerate={(sourceId) => generateOutline.mutate(sourceId)}
          onSave={(payload) => saveOutline.mutate(payload)}
          generating={generateOutline.isPending}
          saving={saveOutline.isPending}
        />
      )}
```

- [ ] **Step 6: Verify**

Run: `npm run build && npm run test:unit`

Expected: both PASS. There is no client test framework, so correctness of the UI itself is confirmed by the manual check below.

- [ ] **Step 7: Commit**

```bash
git add client/src/hooks/useMaterials.js client/src/lib/queryKeys.js client/src/pages/course-materials/OutlineModal.jsx client/src/pages/course-materials/MaterialCard.jsx client/src/pages/CourseMaterials.jsx
git commit -m "Let instructors view, edit, and regenerate a material's outline

Each material card opens its outline, flagging materials that have none since
those fall back to a content search for objective generation. Regenerating an
edited outline requires a second press, because it discards the instructor's
work."
```

---

## Final Verification

- [ ] `npm run test:unit` — full suite green, including the five new test files.
- [ ] `npm run build` — client builds clean.
- [ ] `grep -rn "getOrCreateOutline" src/ client/src/` — no output. The split API must not be recombined.
- [ ] `grep -n "generateOutline" src/controllers/rag-llm.js` — no output. Objective generation must never generate an outline.
- [ ] Manual: upload a small text material, confirm the card shows an outline exists and the modal renders topics.
- [ ] Manual: generate objectives for that material and confirm the server log shows no retrieval, then delete the outline in Mongo and confirm the fallback log line appears.
- [ ] Manual: edit an outline, save, reopen — confirm the edit persisted and the card shows it as instructor-edited.
- [ ] Manual: press Regenerate on an edited outline and confirm it warns before replacing.
- [ ] Manual: edit the material's text content and confirm the outline is cleared.
- [ ] `npm run test:e2e` — existing Playwright specs still pass; the materials page gained a button but no existing flow changed.
