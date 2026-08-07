# Multiple Materials per Meta Learning Objective

**Date:** 2026-08-07
**Status:** Approved, ready for implementation planning
**Branch:** `kx-learning-objective-multi-source`

## Problem

An instructor can attach only one course material when generating meta learning
objectives (LOs). The "Create Learning Objectives" modal in the question
generation wizard renders materials as radio buttons, so a meta LO that spans a
lecture deck and a textbook chapter cannot be expressed.

A second, subtler problem sits underneath it. RAG retrieval for multiple
materials issues a *single* vector search filtered to the union of the selected
sourceIds, then takes the top N chunks by cosine similarity. Similarity ranking
is not balanced across sources, so one dense material can crowd the others out
entirely — a material can be selected and contribute nothing. This already
affects question generation, which retrieves against every material linked to
the meta LO.

## Goals

- Attach up to 3 materials to a meta LO, from both the generation wizard and the
  Question Bank.
- Guarantee every selected material contributes retrieved context.
- Leave single-material behaviour bit-identical to today.

## Non-goals

- Changing the data model. `grasp_objective_material` is already many-to-many.
- Migrating or trimming existing over-cap LOs.
- Per-material weighting or instructor-tunable retrieval budgets per LO.

## Current state

| Concern | Where | State |
|---|---|---|
| Objective↔material links | `grasp_objective_material` via `src/services/objective-material.js` | Already many-to-many, uncapped |
| LO generation material picker | `client/src/pages/question-generation/AIGenerateModal.jsx` | **Radio — single material** |
| Question Bank material picker | `client/src/pages/question-bank/ObjectivesTab.jsx` | Checkboxes, **uncapped** |
| Attached materials in wizard | `client/src/pages/question-generation/ObjectiveGroupCard.jsx` | Not displayed; `materialIds` rides along invisibly |
| RAG retrieval | `src/services/rag.js` | **Single union search**, crowd-out defect |

## Design

### 1. Cap

`MAX_MATERIALS_PER_OBJECTIVE = 3` in `src/constants/app-constants.js`, mirrored
in `client/src/lib/constants.js` (the same duplication pattern `BLOOM_LEVELS`
already uses).

Server enforcement lives in `src/services/objective-material.js` *only*.
`createObjectiveMaterialRelations` throws a typed `MaterialCapExceededError`
when given more than 3 sourceIds. Both write paths — `POST /api/objective` and
`PUT /api/objective/:id/materials` — already funnel through
`updateObjectiveMaterialRelations` → `createObjectiveMaterialRelations`, so a
single guard covers every caller and no controller can bypass it. Controllers
map the error to `400 { success: false, code: "MATERIAL_CAP_EXCEEDED" }`.

Reads are deliberately untouched. `getMaterialsForObjective` and
`getDetailedObjectives` return however many links exist, so legacy LOs created
before the cap keep generating questions normally.

The cap is a product guardrail, not a technical constraint: with equal-split
budgeting (below), 5 materials costs the same tokens as 3. Relaxing it later is
a one-constant change.

### 2. RAG fan-out and merge

New method on `RAGService`:

```js
async getRagContentPerMaterial(sourceIds, query, { totalLimit, courseId, scoreThreshold })
```

Behaviour:

- Per-material quota is `Math.ceil(totalLimit / sourceIds.length)`.
- One `retrieveContext` call per sourceId, each filtered to that single source
  (`{ must: [{ key: "sourceId", match: { any: [sid] } }] }`), issued
  concurrently.
- **Per-material threshold fallback.** A material returning 0 chunks retries
  itself without the score threshold. Today the fallback is all-or-nothing
  across the union, so one weak material either drags every material below the
  bar or is silently dropped.
- **Leftover redistribution, single pass.** Each search *requests* `totalLimit`
  chunks but the merge initially *keeps* only the material's quota. Any budget
  left unused by materials that returned fewer than their quota is then filled
  from the already-retrieved surplus chunks, taken in score order, bounded by
  `totalLimit` overall. Because the surplus is fetched in the first round, no
  second round of queries is needed — retrieval stays at exactly N searches.
  Merged context size stays stable whether the selected materials are dense or
  sparse.
- Merge reuses the existing `### MATERIAL: <title> (SOURCE ID: <sid>)` grouping
  format verbatim. The auto LO-generation prompt interpolates `{sourceIdsList}`
  and expects that shape, so the prompt contract does not change.

`getRagContentFromMaterials` and `getLearningObjectiveRagContent` both delegate
to the new method. The union-search path is removed rather than kept as a
branch — one retrieval strategy, not two.

**Single-material equivalence:** with `n = 1`, quota is `ceil(total/1) = total`,
producing one search with the same filter shape, limit, and threshold fallback
as today. No single-material LO changes behaviour.

### 3. Retrieval budgets as environment variables

Both totals become configurable, with today's values as defaults:

| Variable | Default | Replaces |
|---|---|---|
| `RAG_OBJECTIVE_CHUNK_LIMIT` | 200 | hardcoded `200` in `src/controllers/rag-llm.js` (LO generation) |
| `RAG_CHUNK_LIMIT` | 50 | existing, unchanged (question generation) |
| `RAG_SCORE_THRESHOLD` | 0.6 | existing, unchanged |

`RAG_CHUNK_LIMIT` and `RAG_SCORE_THRESHOLD` are read by code today but absent
from `.env.example`. All three get documented there.

### 4. UI

**`AIGenerateModal.jsx`** — `selectedMaterial` (string) becomes
`selectedMaterialIds` (array); radio inputs become checkboxes. Unchecked rows
disable once 3 are selected, with a `"3 of 3 selected (max)"` counter.
`materialTitles` is built for every selected material rather than one. The three
`materialIds: [selectedMaterial]` call sites use the array. Instructional copy
updates from "Select a course material" to describe multi-select.

**`ObjectivesTab.jsx`** — the existing checkbox grid gains the same
disable-at-3 behaviour and counter. A legacy LO opened with more than 3 shows an
inline warning (`"5 selected, max 3 — remove 2 to save"`) and
`handleSaveObjective` blocks until the instructor trims it. Nothing is silently
dropped.

**`ObjectiveGroupCard.jsx`** — read-only material chips in the card header,
resolved by joining `group.materialIds` against `useCourseMaterials`. The
instructor can see what questions will be generated from without introducing a
third editing surface or save path.

### 5. Error handling

| Case | Behaviour |
|---|---|
| Save with >3 materials | Blocked client-side; server `400 MATERIAL_CAP_EXCEEDED` as the backstop for direct API callers |
| One material has no indexed content | Contributes 0 chunks; others still generate. Only an all-empty merge triggers the existing "No content found in selected materials" 400 |
| One `retrieveContext` rejects | Fan-out uses `Promise.allSettled`: the failure is logged, that material yields 0 chunks, generation proceeds. If every material rejects, the error propagates as today |
| Zero materials selected | Unchanged — existing "At least one material must be selected" 400 |

### 6. Testing

`tests/unit/rag-fanout.service.test.js`, against a stubbed RAG instance:

- quota split for n = 1, 2, 3; n = 1 issues exactly one search at the full limit
- leftover redistribution when a material under-delivers, and that it happens
  without issuing more than N searches
- per-material threshold fallback fires only for the empty material
- `allSettled` isolation: one rejecting material does not fail the merge
- merged output preserves the `### MATERIAL:` grouping

`tests/unit/objective-material-cap.service.test.js`:

- 3 sourceIds succeed; 4 throw `MaterialCapExceededError`
- an existing 5-link objective still reads back all 5 materials
- the controller maps the error to `400` / `MATERIAL_CAP_EXCEEDED`

No E2E changes — the wizard flow is unchanged in shape.

## Consequences

- Fan-out issues N embedding searches per generation instead of 1. They run
  concurrently, so wall-clock cost is roughly one search, but peak Qdrant query
  load triples for a 3-material LO.
- Token cost is unchanged from today at every material count, because the budget
  is split rather than multiplied.
- Multi-material LOs that previously generated from one crowd-out winner will
  produce different (better-grounded) questions than before. This is the point
  of the change, but it means regenerating an existing multi-material LO will
  not reproduce its earlier output.
