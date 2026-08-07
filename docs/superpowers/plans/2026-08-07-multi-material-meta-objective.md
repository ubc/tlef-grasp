# Multi-Material Meta Learning Objectives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an instructor attach up to 3 course materials to a meta learning objective, and retrieve RAG context per material so every attached material is guaranteed to contribute.

**Architecture:** A shared `MAX_MATERIALS_PER_OBJECTIVE = 3` constant, enforced server-side at the single write chokepoint in `objective-material.js`. Retrieval strategy moves out of the untestable `rag.js` singleton into a new dependency-free `rag-fanout.js`: one vector search per material, each material guaranteed a quota of a fixed total chunk budget, unspent budget redistributed from already-fetched surplus in score order. Three client surfaces gain multi-select, cap enforcement, and visibility.

**Tech Stack:** Node.js + Express + MongoDB (native driver), Qdrant via `ubc-genai-toolkit-rag`, React 18 + Vite + React Query + Tailwind, Jest for server unit tests, Playwright for E2E/a11y.

**Spec:** `docs/superpowers/specs/2026-08-07-multi-material-meta-objective-design.md`

## Global Constraints

- **Branch:** `kx-learning-objective-multi-source` (already checked out, based on `76def16`).
- **Cap value:** `MAX_MATERIALS_PER_OBJECTIVE = 3`. Never inline the literal `3`; always import the constant.
- **Error code string:** exactly `MATERIAL_CAP_EXCEEDED`.
- **JS, not TS.** No type annotations anywhere. The project is deliberately plain JavaScript.
- **Server modules are CommonJS** (`require` / `module.exports`). Client modules are ESM (`import` / `export`).
- **Reads must never enforce the cap.** Legacy objectives with more than 3 materials must keep loading and generating. Only writes reject.
- **Single-material behaviour must not change.** With one material the retrieval path must issue exactly one search at the full limit, with the same filter shape and threshold fallback as before.
- **Prompt output formats must not change.** `getRagContentFromMaterials` keeps the `### MATERIAL: <title> (SOURCE ID: <sid>)` grouped format joined by `\n\n---\n\n`; `getLearningObjectiveRagContent` keeps a plain `\n\n` join with no headers.
- **Env var defaults:** `RAG_OBJECTIVE_CHUNK_LIMIT=200`, `RAG_CHUNK_LIMIT=50`, `RAG_SCORE_THRESHOLD=0.6`. Defaults must apply when the variable is unset.
- **Run server unit tests with** `npx jest <path>`. The full suite is `npm run test:unit`.
- **There is no client-side unit test framework.** Client changes are verified with `npm run build` and manual checks. Do not add Vitest or Jest to `client/`.
- **`src/services/rag.js` cannot be required under Jest** (`ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG`, from its constructor's dynamic `import()`). Never write a test that requires it directly.
- **Commit after every task.** Use the exact commit messages given.

---

### Task 1: Material cap constant and server-side enforcement

The cap is enforced in exactly one place. Both real write paths (`POST /api/objective` and `PUT /api/objective/:id/materials`) funnel through `updateObjectiveMaterialRelations` → `createObjectiveMaterialRelations`.

Critically, `updateObjectiveMaterialRelations` **deletes existing links before creating new ones**. A guard placed only in `createObjectiveMaterialRelations` would delete the instructor's current materials and *then* reject, losing data. Both functions need the guard, and `updateObjectiveMaterialRelations` must check before its delete.

**Files:**
- Modify: `src/constants/app-constants.js` (add constant, add to `module.exports` at line ~288)
- Modify: `src/services/objective-material.js` (add error class + two guards, extend `module.exports`)
- Modify: `src/controllers/objective.js` (map error to 400 in `createObjectiveHandler` ~line 151 and `updateObjectiveMaterials` ~line 206)
- Test: `tests/unit/objective-material-cap.service.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `MAX_MATERIALS_PER_OBJECTIVE` (number, `3`) exported from `src/constants/app-constants.js`
  - `MaterialCapExceededError` class exported from `src/services/objective-material.js`, with instance properties `name === 'MaterialCapExceededError'`, `code === 'MATERIAL_CAP_EXCEEDED'`, `attempted` (number), `max` (number)
  - Both `createObjectiveMaterialRelations(objectiveId, materialSourceIds)` and `updateObjectiveMaterialRelations(objectiveId, materialSourceIds)` throw `MaterialCapExceededError` when `materialSourceIds.length > 3`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/objective-material-cap.service.test.js`:

```js
const { ObjectId } = require('mongodb');

jest.mock('../../src/services/database', () => ({
  connect: jest.fn(),
}));

const databaseService = require('../../src/services/database');
const {
  createObjectiveMaterialRelations,
  updateObjectiveMaterialRelations,
  getMaterialsForObjective,
  MaterialCapExceededError,
} = require('../../src/services/objective-material');
const { MAX_MATERIALS_PER_OBJECTIVE } = require('../../src/constants/app-constants');

const makeMaterial = (sourceId) => ({ _id: new ObjectId(), sourceId });

describe('material cap per learning objective', () => {
  let relationshipCollection;
  let materialCollection;

  const stubMaterialLookup = (materials) => {
    materialCollection.find.mockReturnValue({
      toArray: jest.fn().mockResolvedValue(materials),
    });
  };

  beforeEach(() => {
    relationshipCollection = {
      insertMany: jest.fn().mockResolvedValue({ insertedCount: 0 }),
      deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }),
      find: jest.fn(() => ({ toArray: jest.fn().mockResolvedValue([]) })),
    };
    materialCollection = {
      find: jest.fn(() => ({ toArray: jest.fn().mockResolvedValue([]) })),
      findOne: jest.fn(),
    };
    databaseService.connect.mockResolvedValue({
      collection: jest.fn((name) => {
        if (name === 'grasp_objective_material') return relationshipCollection;
        if (name === 'grasp_material') return materialCollection;
        throw new Error(`Unexpected collection: ${name}`);
      }),
    });
  });

  it('exposes the cap as a shared constant', () => {
    expect(MAX_MATERIALS_PER_OBJECTIVE).toBe(3);
  });

  it('accepts exactly the maximum number of materials', async () => {
    const sourceIds = ['m1', 'm2', 'm3'];
    stubMaterialLookup(sourceIds.map(makeMaterial));

    await createObjectiveMaterialRelations(new ObjectId().toString(), sourceIds);

    expect(relationshipCollection.insertMany).toHaveBeenCalledTimes(1);
    expect(relationshipCollection.insertMany.mock.calls[0][0]).toHaveLength(3);
  });

  it('rejects more than the maximum without writing anything', async () => {
    const attempt = createObjectiveMaterialRelations(new ObjectId().toString(), [
      'm1',
      'm2',
      'm3',
      'm4',
    ]);

    await expect(attempt).rejects.toThrow(MaterialCapExceededError);
    await expect(attempt).rejects.toMatchObject({
      code: 'MATERIAL_CAP_EXCEEDED',
      attempted: 4,
      max: 3,
    });
    expect(relationshipCollection.insertMany).not.toHaveBeenCalled();
  });

  // updateObjectiveMaterialRelations deletes before it creates. Guarding only
  // the create would wipe the instructor's existing materials and then fail.
  it('rejects an over-cap update before deleting existing links', async () => {
    await expect(
      updateObjectiveMaterialRelations(new ObjectId().toString(), ['m1', 'm2', 'm3', 'm4'])
    ).rejects.toThrow(MaterialCapExceededError);

    expect(relationshipCollection.deleteMany).not.toHaveBeenCalled();
    expect(relationshipCollection.insertMany).not.toHaveBeenCalled();
  });

  it('still reads back every material on a legacy over-cap objective', async () => {
    const objectiveId = new ObjectId();
    const legacy = ['m1', 'm2', 'm3', 'm4', 'm5'].map(makeMaterial);
    relationshipCollection.find.mockReturnValue({
      toArray: jest
        .fn()
        .mockResolvedValue(legacy.map((m) => ({ objectiveId, materialId: m._id }))),
    });
    stubMaterialLookup(legacy);

    await expect(getMaterialsForObjective(objectiveId.toString())).resolves.toHaveLength(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/objective-material-cap.service.test.js`

Expected: FAIL. `MaterialCapExceededError` is `undefined`, so `rejects.toThrow(undefined)` and the constant assertion both fail with errors like `expect(received).toBe(expected) // Object.is equality — Expected: 3, Received: undefined`.

- [ ] **Step 3: Add the constant**

In `src/constants/app-constants.js`, add above `module.exports`:

```js
/**
 * Maximum course materials an instructor can attach to one meta learning
 * objective. A product guardrail rather than a technical limit: retrieval splits
 * a fixed chunk budget across however many materials are attached, so raising
 * this does not raise token cost. Objectives created before the cap existed may
 * exceed it — reads tolerate that, writes do not.
 */
const MAX_MATERIALS_PER_OBJECTIVE = 3;
```

Then add `MAX_MATERIALS_PER_OBJECTIVE,` to the `module.exports` object.

- [ ] **Step 4: Add the error class and both guards**

In `src/services/objective-material.js`, after the existing requires at the top:

```js
const { MAX_MATERIALS_PER_OBJECTIVE } = require('../constants/app-constants');

/**
 * Thrown when a write would attach more than MAX_MATERIALS_PER_OBJECTIVE
 * materials to one objective. Carries a `code` so controllers can map it to a
 * 400 without string-matching the message.
 */
class MaterialCapExceededError extends Error {
  constructor(attempted) {
    super(
      `Cannot attach ${attempted} materials to a learning objective; the maximum is ${MAX_MATERIALS_PER_OBJECTIVE}.`
    );
    this.name = 'MaterialCapExceededError';
    this.code = 'MATERIAL_CAP_EXCEEDED';
    this.attempted = attempted;
    this.max = MAX_MATERIALS_PER_OBJECTIVE;
  }
}

/** Throws if the requested material list exceeds the cap. */
const assertWithinMaterialCap = (materialSourceIds) => {
  if (materialSourceIds && materialSourceIds.length > MAX_MATERIALS_PER_OBJECTIVE) {
    throw new MaterialCapExceededError(materialSourceIds.length);
  }
};
```

In `createObjectiveMaterialRelations`, add the guard as the first statement, **before** the `try` — a cap violation is a client error and should not be logged as an internal failure:

```js
const createObjectiveMaterialRelations = async (objectiveId, materialSourceIds) => {
  assertWithinMaterialCap(materialSourceIds);
  try {
```

In `updateObjectiveMaterialRelations`, add the same guard as the first statement before the `try`, so the delete never runs on a doomed write:

```js
const updateObjectiveMaterialRelations = async (objectiveId, materialSourceIds) => {
  // Checked before the removal below: this function deletes existing links
  // before creating the new ones, so a late failure would lose data.
  assertWithinMaterialCap(materialSourceIds);
  try {
```

Add `MaterialCapExceededError,` to `module.exports`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest tests/unit/objective-material-cap.service.test.js`

Expected: PASS, 5 tests.

- [ ] **Step 6: Map the error to a 400 in both controllers**

In `src/controllers/objective.js`, in the `catch` block of `createObjectiveHandler`, add before the existing `console.error`:

```js
  } catch (error) {
    if (error.code === 'MATERIAL_CAP_EXCEEDED') {
      return res.status(400).json({
        success: false,
        code: error.code,
        error: error.message,
      });
    }
    console.error('Error creating objective:', error);
```

Apply the identical block in the `catch` of `updateObjectiveMaterials`, keeping its existing `console.error('Error updating material relationships:', error);` line after it.

- [ ] **Step 7: Run the full suite**

Run: `npm run test:unit`

Expected: PASS. No previously-passing test regresses.

- [ ] **Step 8: Commit**

```bash
git add src/constants/app-constants.js src/services/objective-material.js src/controllers/objective.js tests/unit/objective-material-cap.service.test.js
git commit -m "Cap materials per learning objective at three

Enforced in objective-material.js, which both write paths funnel through.
The guard runs before updateObjectiveMaterialRelations deletes existing
links, so a rejected write cannot lose the instructor's current materials.
Reads are untouched: objectives created before the cap keep loading."
```

---

### Task 2: Stop `PUT /api/objective/:id` from advertising `materialIds`

`updateObjectiveHandler` destructures `materialIds` and never uses it. `ObjectivesStep.saveObjectiveToDatabase` sends it on every autosave, where it is silently discarded, and the route's JSDoc documents it as if honoured.

Remove the misleading field rather than wiring it up. Wiring it would make wizard autosaves rewrite material links as a side effect of editing a granular objective's text — and would create a third write path.

**Files:**
- Modify: `src/controllers/objective.js:218` (drop `materialIds` from the destructure, add comment)
- Modify: `src/routes/objective.js:52` (fix JSDoc)
- Modify: `client/src/pages/question-generation/ObjectivesStep.jsx:72` (drop the unused payload field)
- Test: `tests/unit/objective-update-materials.route.test.js`

**Interfaces:**
- Consumes: `MaterialCapExceededError` handling from Task 1 (already in place; this task does not change it).
- Produces: no new exports. `PUT /api/objective/:id` provably does not touch material relations.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/objective-update-materials.route.test.js`:

```js
const { ObjectId } = require('mongodb');

jest.mock('../../src/services/objective', () => ({
  getParentObjectives: jest.fn(),
  getDetailedObjectives: jest.fn(),
  getGranularObjectives: jest.fn(),
  createObjective: jest.fn(),
  getObjectiveWithMaterials: jest.fn(),
  updateObjective: jest.fn(),
  getObjectiveDeletionImpact: jest.fn(),
  deleteObjective: jest.fn(),
  getObjectiveCourseId: jest.fn(),
}));
jest.mock('../../src/services/objective-material', () => ({
  updateObjectiveMaterialRelations: jest.fn(),
  getMaterialsForObjective: jest.fn(),
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

const objectiveService = require('../../src/services/objective');
const objectiveMaterialService = require('../../src/services/objective-material');
const { updateObjectiveHandler } = require('../../src/controllers/objective');

const makeRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

describe('PUT /api/objective/:id and material relations', () => {
  // Materials belong to PUT /:id/materials. If this endpoint ever starts
  // honouring materialIds, wizard autosaves would silently rewrite material
  // links whenever an instructor edits a granular objective's text.
  it('never touches material relations, even when sent materialIds', async () => {
    const objectiveId = new ObjectId().toString();
    const courseId = new ObjectId().toString();
    objectiveService.updateObjective.mockResolvedValue({
      _id: objectiveId,
      name: 'Renamed',
      granularObjectives: [],
    });

    const req = {
      params: { id: objectiveId },
      user: { id: 'u1' },
      body: {
        name: 'Renamed',
        courseId,
        materialIds: ['m1', 'm2', 'm3', 'm4', 'm5'],
        granularObjectives: [],
      },
    };
    const res = makeRes();

    await updateObjectiveHandler(req, res);

    expect(objectiveMaterialService.updateObjectiveMaterialRelations).not.toHaveBeenCalled();
    expect(objectiveService.updateObjective).toHaveBeenCalledWith(
      objectiveId,
      expect.not.objectContaining({ materialIds: expect.anything() })
    );
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});
```

- [ ] **Step 2: Run test to verify it passes for the wrong reason, then confirm the real gap**

Run: `npx jest tests/unit/objective-update-materials.route.test.js`

Expected: PASS immediately. That is the point — this test pins down behaviour that is already correct but undocumented and easy to break. Confirm the misleading surface still exists:

Run: `grep -n "materialIds" src/controllers/objective.js src/routes/objective.js client/src/pages/question-generation/ObjectivesStep.jsx`

Expected: shows the dead destructure at `src/controllers/objective.js:218`, the JSDoc claim at `src/routes/objective.js:52`, and the unused payload field at `ObjectivesStep.jsx:72`.

- [ ] **Step 3: Remove the dead destructure**

In `src/controllers/objective.js`, change line 218 from:

```js
    const { name, granularObjectives, materialIds, courseId, questionAction } = req.body;
```

to:

```js
    // Materials are deliberately not read here: they are written only by
    // PUT /api/objective/:id/materials. Honouring them on this endpoint would
    // make the wizard's autosave rewrite material links as a side effect of
    // editing an objective's name or granular list.
    const { name, granularObjectives, courseId, questionAction } = req.body;
```

- [ ] **Step 4: Fix the route JSDoc**

In `src/routes/objective.js`, change the comment block above `router.put('/:id', ...)` from:

```js
 * Body: { name: string, granularObjectives: Array<{id?: string, text: string}>, materialIds: Array<string> }
```

to:

```js
 * Body: { name: string, granularObjectives: Array<{id?: string, text: string}> }
 * Materials are not updated here — use PUT /api/objective/:id/materials.
```

- [ ] **Step 5: Drop the unused client payload field**

In `client/src/pages/question-generation/ObjectivesStep.jsx`, in `saveObjectiveToDatabase`, remove the `materialIds` line from the PUT body:

```js
      const data = await api.put(`/api/objective/${group.objectiveId}`, {
        name: group.title,
        courseId: course.id,
        granularObjectives,
      });
```

- [ ] **Step 6: Verify**

Run: `npx jest tests/unit/objective-update-materials.route.test.js && npm run test:unit && npm run build`

Expected: the new test PASSes, the full suite PASSes, and the client build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/controllers/objective.js src/routes/objective.js client/src/pages/question-generation/ObjectivesStep.jsx tests/unit/objective-update-materials.route.test.js
git commit -m "Stop PUT /api/objective/:id advertising materialIds it ignores

The handler destructured materialIds and never used it, so the wizard's
autosave sent material links on every keystroke and the server dropped
them. Removes the dead field rather than wiring it up: honouring it would
rewrite material links as a side effect of a text edit. Adds a regression
test pinning the endpoint to name and granular updates only."
```

---

### Task 3: Per-material RAG retrieval module

The heart of the change, in a new dependency-free module so it is actually testable. `src/services/rag.js` cannot be required under Jest — its constructor calls `await import("ubc-genai-toolkit-rag")`, which fails with `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG`. Every function here takes its RAG instance as an argument and returns plain data.

This task does not touch `rag.js`. Wiring happens in Task 4.

**Files:**
- Create: `src/services/rag-fanout.js`
- Test: `tests/unit/rag-fanout.service.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces, all exported from `src/services/rag-fanout.js`:
  - `computeQuotas(totalLimit, materialCount)` → `Array<number>` of length `materialCount`, summing to exactly `totalLimit`
  - `retrieveForSource(instance, sourceId, query, limit, scoreThreshold)` → `Promise<Array<chunk>>`
  - `mergePerMaterialChunks(perMaterialChunks, totalLimit)` → `Array<chunk>`, where `perMaterialChunks` is `Array<Array<chunk>>`
  - `retrieveChunksPerMaterial(instance, sourceIds, query, { totalLimit, scoreThreshold })` → `Promise<Array<chunk>>`
  - `formatChunksByMaterial(chunks)` → `string`
  - A `chunk` is `{ content: string, score: number, metadata: { sourceId, documentTitle?, fileName? } }` — the shape `instance.retrieveContext` already returns.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/rag-fanout.service.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/rag-fanout.service.test.js`

Expected: FAIL with `Cannot find module '../../src/services/rag-fanout' from 'tests/unit/rag-fanout.service.test.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/services/rag-fanout.js`:

```js
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

  let chunks = await instance.retrieveContext(query, { limit, scoreThreshold, filter });

  if ((!chunks || chunks.length === 0) && scoreThreshold !== undefined) {
    console.log(
      `⚠️ Score threshold ${scoreThreshold} returned 0 chunks for material ${sourceId} — retrying without threshold`
    );
    chunks = await instance.retrieveContext(query, { limit, filter });
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
  const settled = await Promise.allSettled(
    sourceIds.map((sourceId) =>
      retrieveForSource(instance, sourceId, query, totalLimit, scoreThreshold)
    )
  );

  // One material failing must not cost the others their context.
  const perMaterialChunks = settled.map((outcome, index) => {
    if (outcome.status === 'rejected') {
      console.warn(
        `⚠️ RAG search failed for material ${sourceIds[index]}:`,
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
    `✅ Retrieved ${merged.length} chunks from ${contributing}/${sourceIds.length} materials (budget ${totalLimit}, threshold ${scoreThreshold ?? 'none'})`
  );

  return merged;
};

/**
 * Group chunks under a header per material, for prompts that cite their sources.
 * Output format is load-bearing: the auto objective-generation prompt
 * interpolates {sourceIdsList} and expects these headers.
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/rag-fanout.service.test.js`

Expected: PASS, 17 tests across 4 describe blocks.

- [ ] **Step 5: Commit**

```bash
git add src/services/rag-fanout.js tests/unit/rag-fanout.service.test.js
git commit -m "Add per-material RAG retrieval with quota-based merging

A single union search ranks by similarity alone, so a dense material can
take every slot and an attached material can contribute nothing. Searches
each material separately, guarantees each a quota of the chunk budget, and
redistributes only unclaimed budget so a sparse material is never displaced.

Lives in its own module because rag.js cannot be required under Jest: its
constructor dynamically imports the toolkit, which fails with
ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG."
```

---

### Task 4: Wire fan-out into the RAG service and make budgets configurable

Replaces both union searches with the fan-out module and lifts the hardcoded `200` into an env var.

Each caller keeps its **own** output format. `getRagContentFromMaterials` groups by material; `getLearningObjectiveRagContent` returns a plain `\n\n` join with no headers. Changing either would silently alter live prompts.

No new unit test: `rag.js` cannot be required under Jest. Verification is the full suite plus a manual smoke run.

**Files:**
- Modify: `src/services/rag.js` (require the module; rewrite `getLearningObjectiveRagContent` ~lines 210-248 and `getRagContentFromMaterials` ~lines 250-306)
- Modify: `src/controllers/rag-llm.js:696` (env var for the objective budget)
- Modify: `.env.example` (document all three RAG vars)

**Interfaces:**
- Consumes from Task 3: `retrieveChunksPerMaterial(instance, sourceIds, query, { totalLimit, scoreThreshold })` and `formatChunksByMaterial(chunks)` from `src/services/rag-fanout.js`.
- Produces: unchanged public signatures — `getLearningObjectiveRagContent(objectiveId, query, courseId, scoreThreshold, limit)` and `getRagContentFromMaterials(sourceIds, query, limit, courseId, scoreThreshold)`, both still returning `Promise<string>`. Callers need no changes.

- [ ] **Step 1: Require the fan-out module**

In `src/services/rag.js`, add to the requires at the top:

```js
const {
  retrieveChunksPerMaterial,
  formatChunksByMaterial,
} = require('./rag-fanout');
```

- [ ] **Step 2: Rewrite `getLearningObjectiveRagContent`**

Replace the whole method body. Note it keeps the plain join — **no** material headers:

```js
  async getLearningObjectiveRagContent(objectiveId, query, courseId = null, scoreThreshold = undefined, limit = 20) {
    const instance = await this.getOrCreateInstance(courseId);
    if (!instance) {
      throw new Error("RAG instance is not initialized for this course");
    }

    if (!query) {
      throw new Error("Query parameter is required");
    }

    const objective = await getObjectiveWithMaterials(objectiveId);

    if (!objective) {
      throw new Error(`Objective with ID ${objectiveId} not found`);
    }

    const sourceIds = objective.materials.map((material) => material.sourceId);
    if (sourceIds.length === 0) {
      console.log("⚠️ Objective has no attached materials");
      return '';
    }

    // One search per material, each guaranteed a share of `limit`, so a dense
    // material cannot crowd out the others.
    const chunks = await retrieveChunksPerMaterial(instance, sourceIds, query, {
      totalLimit: limit,
      scoreThreshold,
    });

    // Plain join, no per-material headers: the question-generation prompt has
    // always received context in this shape.
    return chunks.map((chunk) => chunk.content).join("\n\n");
  }
```

- [ ] **Step 3: Rewrite `getRagContentFromMaterials`**

Replace the whole method body. This one keeps the grouped format:

```js
  /**
   * Get RAG content from multiple materials by sourceIds, grouped by material.
   * @param {Array<string>} sourceIds - Array of material sourceIds
   * @param {string} query - Query string for RAG search
   * @param {number} limit - Total chunk budget, split across the materials
   * @returns {Promise<string>} Combined RAG context, grouped per material
   */
  async getRagContentFromMaterials(sourceIds, query = "course content", limit = 50, courseId = null, scoreThreshold = undefined) {
    const instance = await this.getOrCreateInstance(courseId);
    if (!instance) {
      throw new Error("RAG instance is not initialized for this course");
    }

    if (!sourceIds || sourceIds.length === 0) {
      throw new Error("At least one sourceId is required");
    }

    const chunks = await retrieveChunksPerMaterial(instance, sourceIds, query, {
      totalLimit: limit,
      scoreThreshold,
    });

    return formatChunksByMaterial(chunks);
  }
```

- [ ] **Step 4: Make the objective budget configurable**

In `src/controllers/rag-llm.js`, in `generateLearningObjectivesHandler`, replace the hardcoded limit. Change:

```js
    let ragContext = await ragService.getRagContentFromMaterials(
      materialIds,
      searchQuery,
      200,
      courseId
    );
```

to:

```js
    const objectiveRagLimit = parseInt(process.env.RAG_OBJECTIVE_CHUNK_LIMIT) || 200;

    let ragContext = await ragService.getRagContentFromMaterials(
      materialIds,
      searchQuery,
      objectiveRagLimit,
      courseId
    );
```

- [ ] **Step 5: Document the RAG variables**

In `.env.example`, after the `OLLAMA_QDRANT_VECTOR_SIZE=768` line, add:

```
# --- RAG retrieval ---
# Total chunk budget per generation, split evenly across the materials attached
# to a learning objective. Each material is guaranteed a share, so adding
# materials does not increase token cost.
RAG_OBJECTIVE_CHUNK_LIMIT=200
RAG_CHUNK_LIMIT=50
# Minimum similarity score for a chunk. A material that returns nothing at this
# threshold is retried without it.
RAG_SCORE_THRESHOLD=0.6
```

- [ ] **Step 6: Verify no union-search code survives**

Run: `grep -n "match: { any:" src/services/rag.js`

Expected: **no output.** The only remaining single-source filter lives in `rag-fanout.js`.

Run: `grep -n "retrieveContext" src/services/rag.js`

Expected: **no output.** All retrieval now goes through the fan-out module.

- [ ] **Step 7: Run the full suite**

Run: `npm run test:unit`

Expected: PASS. `question-generation.controller.test.js` mocks the rag service wholesale, so it must still pass untouched.

- [ ] **Step 8: Smoke test against a running stack**

This is the only coverage for the wiring itself, so do not skip it. With Qdrant, Mongo, and the LLM provider configured per `.env`:

```bash
npm run dev
```

Then in the browser: open a course with at least 2 processed materials → Question Generation → **Create Learning Objectives** → generate. In the server log, confirm a line of the form:

```
✅ Retrieved 200 chunks from 2/2 materials (budget 200, threshold none)
```

Then generate questions for a saved objective and confirm a similar line with `budget 50, threshold 0.6`. Both must report every attached material as contributing.

- [ ] **Step 9: Commit**

```bash
git add src/services/rag.js src/controllers/rag-llm.js .env.example
git commit -m "Retrieve RAG context per material instead of one union search

Both retrieval methods now fan out through rag-fanout, so every material
attached to an objective is guaranteed a share of the chunk budget. Each
caller keeps its existing output format: grouped headers for objective
generation, a plain join for question generation.

Lifts the hardcoded 200-chunk objective budget into
RAG_OBJECTIVE_CHUNK_LIMIT and documents RAG_CHUNK_LIMIT and
RAG_SCORE_THRESHOLD, which were read but never written down."
```

---

### Task 5: Multi-select materials when generating objectives

Turns the radio group into capped checkboxes. This is the change the instructor actually asked for.

**Files:**
- Modify: `client/src/pages/question-generation/AIGenerateModal.jsx`
- Modify: `client/src/lib/constants.js` (mirror the cap)

**Interfaces:**
- Consumes: `MATERIAL_CAP_EXCEEDED` 400 responses from Task 1 (surfaced via the existing `showToast(error.message)` path — no new handling needed).
- Produces: `MAX_MATERIALS_PER_OBJECTIVE` exported from `client/src/lib/constants.js`, used again in Tasks 6 and 7.

- [ ] **Step 1: Mirror the cap in client constants**

In `client/src/lib/constants.js`, append:

```js
// Mirrors MAX_MATERIALS_PER_OBJECTIVE in src/constants/app-constants.js.
// The server rejects writes above this; the UI stops the instructor first.
export const MAX_MATERIALS_PER_OBJECTIVE = 3;
```

- [ ] **Step 2: Switch the modal to a material array**

In `client/src/pages/question-generation/AIGenerateModal.jsx`, add the import:

```js
import { MAX_MATERIALS_PER_OBJECTIVE } from "../../lib/constants";
```

Replace the state declaration:

```js
  const [selectedMaterial, setSelectedMaterial] = useState(null);
```

with:

```js
  const [selectedMaterialIds, setSelectedMaterialIds] = useState([]);
```

Add a toggle helper next to the other handlers, above `handleGenerate`:

```js
  // Cap is enforced here as well as server-side so the instructor is stopped
  // before a rejected save, not after.
  const toggleMaterial = (sourceId) => {
    setSelectedMaterialIds((prev) => {
      if (prev.includes(sourceId)) return prev.filter((id) => id !== sourceId);
      if (prev.length >= MAX_MATERIALS_PER_OBJECTIVE) return prev;
      return [...prev, sourceId];
    });
  };
```

- [ ] **Step 3: Generate from every selected material**

Replace the opening of `handleGenerate`:

```js
  const handleGenerate = async () => {
    if (selectedMaterialIds.length === 0) {
      showToast("Please select at least one material", "warning");
      return;
    }
    setGenerating(true);
    setGenerated(null);
    setGenerationMessage("");
    try {
      const materialTitles = Object.fromEntries(
        selectedMaterialIds.map((sourceId) => [
          sourceId,
          materials.find((m) => m.sourceId === sourceId)?.documentTitle || "",
        ])
      );
      const data = await api.post("/api/rag-llm/generate-learning-objectives", {
        courseId: course.id,
        courseName: course.name,
        materialIds: selectedMaterialIds,
        materialTitles,
        userObjectives: customRows.map((r) => r.trim()).filter(Boolean),
      });
```

Leave the rest of `handleGenerate` unchanged.

- [ ] **Step 4: Save against every selected material**

In `handleSave`, replace both occurrences of `materialIds: [selectedMaterial],` with:

```js
            materialIds: selectedMaterialIds,
```

The first is in the `api.post("/api/objective", …)` body; the second is in the `savedGroups.push({ … })` call.

- [ ] **Step 5: Update the picker to capped checkboxes**

Replace the "Material selection" label, hint, and each material row. The label and hint become:

```jsx
      {/* Material selection */}
      <label className="mb-1 block font-semibold text-ink">
        Select Materials:
      </label>
      <p className="mb-3 text-xs text-muted">
        <i className="fas fa-info-circle mr-1 text-primary" />
        Choose up to {MAX_MATERIALS_PER_OBJECTIVE} course materials. Each one is
        searched separately, so every material you pick contributes to the
        generated objectives.
        <span className="ml-1 font-semibold text-ink">
          {selectedMaterialIds.length} of {MAX_MATERIALS_PER_OBJECTIVE} selected
          {selectedMaterialIds.length >= MAX_MATERIALS_PER_OBJECTIVE ? " (max)" : ""}
        </span>
      </p>
```

Inside the `materials.map(...)`, replace the whole `<label>` with:

```jsx
          materials.map((material) => {
            const isSelected = selectedMaterialIds.includes(material.sourceId);
            const atCap = selectedMaterialIds.length >= MAX_MATERIALS_PER_OBJECTIVE;
            const disabled = !isSelected && atCap;
            return (
              <label
                key={material.sourceId}
                className={`flex items-center gap-3 rounded-lg border p-3 transition-colors ${
                  isSelected
                    ? "border-primary bg-primary/5"
                    : "border-gray-200 hover:border-primary/40"
                } ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  disabled={disabled}
                  onChange={() => toggleMaterial(material.sourceId)}
                  className="h-4 w-4 accent-primary"
                />
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-ink">
                    {material.documentTitle || "Untitled"}
                  </div>
                  <div className="flex gap-4 text-xs text-muted">
                    <span>Type: {getMaterialTypeLabel(material.fileType)}</span>
                    <span>Size: {formatFileSize(material.fileSize || 0)}</span>
                    <span>
                      Uploaded: {new Date(material.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              </label>
            );
          })
```

- [ ] **Step 6: Fix the Generate button's disabled condition**

In the modal footer, change:

```jsx
              disabled={!selectedMaterial || generating}
```

to:

```jsx
              disabled={selectedMaterialIds.length === 0 || generating}
```

- [ ] **Step 7: Update the intro copy**

Change the opening paragraph's first sentence from "Select the course materials you want to use for generating learning objectives." to:

```jsx
        Select up to {MAX_MATERIALS_PER_OBJECTIVE} course materials to generate
        learning objectives from.
```

Leave the rest of that paragraph as-is.

- [ ] **Step 8: Verify no stale references remain**

Run: `grep -n "selectedMaterial\b" client/src/pages/question-generation/AIGenerateModal.jsx`

Expected: **no output.** Every reference is now `selectedMaterialIds`.

Run: `npm run build`

Expected: build succeeds with no errors.

- [ ] **Step 9: Manual check**

With `npm run dev`, open Question Generation → **Create Learning Objectives**. Confirm: checkboxes not radios; a third selection disables and fades the remaining rows; the counter reads `3 of 3 selected (max)`; unchecking one re-enables them; generating with 2 materials produces objectives grounded in both.

- [ ] **Step 10: Commit**

```bash
git add client/src/lib/constants.js client/src/pages/question-generation/AIGenerateModal.jsx
git commit -m "Allow up to three materials when generating objectives

Replaces the single-material radio group with capped checkboxes, so a meta
objective can span a lecture deck and a textbook chapter. Sends every
selected material and its title to the generation endpoint."
```

---

### Task 6: Enforce the cap in the Question Bank picker

This picker is already multi-select but uncapped, so it can create objectives the new server guard would reject. Legacy objectives already over the cap must stay openable and readable — the instructor is asked to trim, never silently truncated.

**Files:**
- Modify: `client/src/pages/question-bank/ObjectivesTab.jsx`

**Interfaces:**
- Consumes from Task 5: `MAX_MATERIALS_PER_OBJECTIVE` from `client/src/lib/constants.js`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Import the cap**

In `client/src/pages/question-bank/ObjectivesTab.jsx`, add `MAX_MATERIALS_PER_OBJECTIVE` to the existing import from `../../lib/constants` if one exists; otherwise add:

```js
import { MAX_MATERIALS_PER_OBJECTIVE } from "../../lib/constants";
```

- [ ] **Step 2: Block an over-cap save**

In `handleSaveObjective`, after the existing empty-selection check, add:

```js
    if (selectedMaterialIds.length > MAX_MATERIALS_PER_OBJECTIVE) {
      showToast(
        `Select at most ${MAX_MATERIALS_PER_OBJECTIVE} course materials`,
        "error"
      );
      return;
    }
```

- [ ] **Step 3: Cap the checkboxes and warn on legacy overage**

Replace the "Associated Course Materials" hint paragraph with a hint plus a conditional warning:

```jsx
          <p className="mb-3 text-xs text-muted">
            Select 1 to {MAX_MATERIALS_PER_OBJECTIVE} materials that cover this
            learning objective.
            <span className="ml-1 font-semibold text-ink">
              {selectedMaterialIds.length} of {MAX_MATERIALS_PER_OBJECTIVE} selected
              {selectedMaterialIds.length === MAX_MATERIALS_PER_OBJECTIVE ? " (max)" : ""}
            </span>
          </p>
          {/* Objectives created before the cap can exceed it. Ask the
              instructor to trim rather than dropping links silently. */}
          {selectedMaterialIds.length > MAX_MATERIALS_PER_OBJECTIVE && (
            <div
              role="alert"
              className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950"
            >
              <i className="fas fa-circle-info mr-1 text-amber-700" aria-hidden="true" />
              This objective has {selectedMaterialIds.length} materials, above the
              limit of {MAX_MATERIALS_PER_OBJECTIVE}. Remove{" "}
              {selectedMaterialIds.length - MAX_MATERIALS_PER_OBJECTIVE} to save your
              changes.
            </div>
          )}
```

Then update the checkbox inside the `courseMaterials.map(...)` so unselected boxes disable at the cap:

```jsx
                    <input
                      type="checkbox"
                      checked={selectedMaterialIds.includes(id)}
                      disabled={
                        !selectedMaterialIds.includes(id) &&
                        selectedMaterialIds.length >= MAX_MATERIALS_PER_OBJECTIVE
                      }
                      onChange={() =>
                        setSelectedMaterialIds((prev) =>
                          prev.includes(id)
                            ? prev.filter((m) => m !== id)
                            : [...prev, id]
                        )
                      }
                      className="h-4 w-4 accent-primary disabled:opacity-40"
                    />
```

- [ ] **Step 4: Verify**

Run: `npm run build`

Expected: build succeeds.

- [ ] **Step 5: Manual check**

With `npm run dev`, go to Question Bank → Learning Objectives → **Add Learning Objective**. Confirm a third selection disables the rest and the counter reads `3 of 3 selected (max)`. Then edit an objective that already has 4+ materials (create one directly in Mongo if none exists) and confirm the amber warning appears, all links stay checked, and Save is refused until trimmed.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/question-bank/ObjectivesTab.jsx
git commit -m "Apply the three-material cap to the Question Bank picker

This picker was multi-select but uncapped, so it could create objectives
the server now rejects. Objectives already over the cap keep every link
visible and are refused with a warning until trimmed, rather than having
materials silently dropped."
```

---

### Task 7: Show attached materials in the generation wizard

The wizard drives generation from `group.materialIds` but never shows them, so an instructor cannot tell what a meta objective will be grounded in. Read-only chips — no new editing surface, no new save path.

**Files:**
- Modify: `client/src/pages/question-generation/ObjectiveGroupCard.jsx`
- Modify: `client/src/pages/question-generation/ObjectivesStep.jsx` (pass the course materials down)

**Interfaces:**
- Consumes from Task 5: `MAX_MATERIALS_PER_OBJECTIVE` from `client/src/lib/constants.js`.
- Consumes existing: `useCourseMaterials(courseId)` from `client/src/hooks/useMaterials.js`, returning `{ materials }` where each material has `sourceId` and `documentTitle`.
- Produces: `ObjectiveGroupCard` accepts a new `courseMaterials` prop (array, defaults to `[]`).

- [ ] **Step 1: Pass course materials into the card**

In `client/src/pages/question-generation/ObjectivesStep.jsx`, add the hook import:

```js
import { useCourseMaterials } from "../../hooks/useMaterials";
```

Next to the existing `useCourseObjectives` call, add:

```js
  const { materials: courseMaterials } = useCourseMaterials(course?.id);
```

Then pass it to each card, alongside the existing props:

```jsx
            <ObjectiveGroupCard
              key={group.id}
              group={group}
              courseMaterials={courseMaterials}
              showValidation={showValidation}
```

- [ ] **Step 2: Render the chips**

In `client/src/pages/question-generation/ObjectiveGroupCard.jsx`, add `courseMaterials = []` to the destructured props of `ObjectiveGroupCard`:

```jsx
export default function ObjectiveGroupCard({
  group,
  courseMaterials = [],
  showValidation,
```

Inside the component, next to the existing `totalCount` calculation, add:

```jsx
  // Resolve the objective's material links to titles for display. Read-only:
  // materials are attached in the Create Learning Objectives modal or the
  // Question Bank, and written only by PUT /api/objective/:id/materials.
  const attachedMaterials = (group.materialIds || []).map((sourceId) => {
    const match = courseMaterials.find((m) => m.sourceId === sourceId);
    return { sourceId, title: match?.documentTitle || match?.fileName || "Untitled material" };
  });
```

Then render them at the top of the expanded body, immediately after `{group.isOpen && (<div className="p-4">`:

```jsx
          {attachedMaterials.length > 0 && (
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                Materials
              </span>
              {attachedMaterials.map((material) => (
                <span
                  key={material.sourceId}
                  title={material.title}
                  className="inline-flex max-w-xs items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
                >
                  <i className="fas fa-file-lines" aria-hidden="true" />
                  <span className="truncate">{material.title}</span>
                </span>
              ))}
            </div>
          )}
          {attachedMaterials.length === 0 && (
            <p className="mb-4 text-xs text-muted">
              <i className="fas fa-circle-info mr-1" aria-hidden="true" />
              No materials attached — questions cannot be generated from course
              content until you attach one in the Question Bank.
            </p>
          )}
```

- [ ] **Step 3: Verify**

Run: `npm run build`

Expected: build succeeds.

- [ ] **Step 4: Manual check**

With `npm run dev`, open Question Generation and add an existing objective that has 2 materials. Confirm both titles appear as chips in the expanded card, long titles truncate rather than wrapping the layout, and an objective with no materials shows the info line instead.

- [ ] **Step 5: Run the full verification pass**

Run: `npm run test:unit && npm run build`

Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/question-generation/ObjectiveGroupCard.jsx client/src/pages/question-generation/ObjectivesStep.jsx
git commit -m "Show a meta objective's attached materials in the wizard

The wizard generates from group.materialIds but never displayed them, so
an instructor could not see what an objective was grounded in. Read-only
chips, with an explicit note when nothing is attached."
```

---

## Final Verification

- [ ] `npm run test:unit` — full server suite passes, including the three new test files.
- [ ] `npm run build` — client builds clean.
- [ ] `npx jest tests/unit/rag-fanout.service.test.js tests/unit/objective-material-cap.service.test.js tests/unit/objective-update-materials.route.test.js` — all new tests pass in isolation.
- [ ] `grep -rn "retrieveContext\|match: { any:" src/services/rag.js` — no output; retrieval fully delegated.
- [ ] `grep -rn "MAX_MATERIALS_PER_OBJECTIVE" src client/src` — the constant is defined twice (server + client mirror) and imported everywhere else; no bare `3` literal stands in for it.
- [ ] Smoke: generate objectives from 2 materials and confirm the server logs every material as contributing.
- [ ] Smoke: generate questions for a single-material objective and confirm one search at the full budget — no behaviour change.
- [ ] `npm run test:e2e` — existing Playwright specs still pass (the wizard's shape is unchanged, so any failure here is a real regression).
