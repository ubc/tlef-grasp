# Material Outlines for Learning Objective Generation

**Date:** 2026-08-10
**Status:** Approved, ready for implementation planning

## Problem

Learning objective generation retrieves up to `RAG_OBJECTIVE_CHUNK_LIMIT`
(default 200) chunks by vector similarity and puts them in the prompt. This is
the wrong retrieval shape for the task.

Generating objectives is a **coverage** problem: the objectives should span what
the material teaches. Top-k similarity search is a **locality** tool, built to
find the few passages matching a specific query. Using it for coverage produces
two concrete defects:

- **The ranking is close to arbitrary.** The query is a generic paragraph
  ("Identify the core knowledge areas, skills, competencies…"), so its embedding
  sits near educational meta-language rather than near course content. Ranking
  chunks against it correlates weakly with whether a chunk matters.
- **For typical materials, retrieval selects nothing at all.** A 200-chunk
  budget covers roughly 170,000 characters of source text. A lecture deck or a
  textbook chapter is smaller than that, so every chunk comes back and the
  "retrieval" is really whole-document stuffing — with document order destroyed
  and query embedding plus Qdrant round trips paid for no selection benefit.

Cost compounds the mismatch. Every generation pays roughly 50,000 input tokens
(~$0.13), and the modal offers a **Regenerate** button, so instructors pay it
repeatedly for an unchanged material.

## Goals

- Give objective generation a coverage artifact instead of a similarity ranking.
- Pay the cost of reading a material once, not once per generation.
- Work for materials larger than a context window.
- Cover the existing corpus without a backfill script or re-uploads.

## Non-goals

- Changing question generation. Retrieval is the correct tool there — it looks
  for content matching one specific granular objective — and it keeps the
  per-material fan-out unchanged.
- Replacing `fileContent`. The outline is derived data, stored alongside it.
- Improving the chunker or chunk metadata. Separate concerns, separately scoped.

## Design

### 1. What gets stored

A **structured topic list**, not prose. The codebase already generates
structured output against JSON schemas (`OBJECTIVES_SCHEMA`,
`IMAGE_DESCRIPTION_SCHEMA`), and an enumerable topic list maps onto "generate
objectives covering this material" far better than a paragraph, which would have
to be re-parsed by the objective model to be useful.

```js
{
  topics: [ { title: string, keyPoints: [string] } ],
  notes: string   // caveats, e.g. "scanned pages, sparse extracted text"
}
```

Persisted on `grasp_material`:

| Field | Purpose |
|---|---|
| `outline` | The parsed object above |
| `outlineGeneratedAt` | When it was produced |
| `outlineModel` | Model used, so a model change can invalidate |
| `outlinePromptHash` | First 16 hex chars of the SHA-256 of the prompt template used (see invalidation) |

`fileContent` is never modified and remains the source of truth, so a thin or
wrong outline is always recoverable by regenerating.

### 2. One entry point

`src/services/material-outline.js` exposes:

```js
getOrCreateOutline(sourceId)   // → outline object
```

It returns the stored outline when present and valid, otherwise generates one
from `fileContent`, stores it, and returns it. Invalidation, map-reduce
batching, and persistence all live behind this one call, so both callers below
are a single line each. The module depends on the database and the LLM, not on
the RAG service.

### 3. Two callers

**At upload, best-effort.** After `saveMaterial` has stored `fileContent`, call
`getOrCreateOutline` guarded so a failure logs and continues. The upload path
already holds its request open through LiteParse OCR and, for PPTX, one vision
call per slide, so it already tolerates long work — this is the right place for
it. But losing a successfully parsed and stored material because its summary
failed would be a bad trade, so the call must never propagate.

**Lazily from objective generation.** When a selected material has no outline,
generate it then. This is what covers the existing corpus with no backfill
script and no re-uploads, and it also covers uploads whose summary step failed.

Same function, two call sites. There is no second mechanism.

### 4. Objective generation path

For each of the ≤3 selected materials, get its outline and render one block,
joined by `\n\n---\n\n` exactly as the retrieval path joins material blocks
today:

```
### MATERIAL: <documentTitle> (SOURCE ID: <sourceId>)
## <topic title>
- <key point>
- <key point>
## <topic title>
- <key point>

NOTES: <notes, omitted entirely when empty>
```

This is the **existing** framing that `getRagContentFromMaterials` produces
today, deliberately preserved: the auto objective prompt interpolates
`{sourceIdsList}` and expects material-attributed content in that shape, so the
prompt contract does not change. No RAG call is made on this path.

The `materialIsRelevant` gate needs no change. If a material is a receipt, its
outline will describe a receipt and the objective model will still reject it.

### 5. Fallback

If an outline cannot be obtained for **any** selected material, the whole
request falls back to today's RAG retrieval path and logs the reason.
Per-material fallback would mix outline and chunk context for marginal benefit;
whole-request behaviour is predictable and easier to reason about when
diagnosing a bad generation.

`RAG_OBJECTIVE_CHUNK_LIMIT` therefore survives, and `.env.example` documents it
as governing the fallback path only.

### 6. Large materials

`fileContent` can exceed a context window. Three constants govern this, defined
in `src/constants/app-constants.js`:

| Constant | Value | Meaning |
|---|---|---|
| `OUTLINE_DIRECT_MAX_CHARS` | 100,000 | At or below this, one summarization call |
| `OUTLINE_BATCH_CHARS` | 80,000 | Batch size above that threshold |
| `OUTLINE_MAX_BATCHES` | 8 | Coverage cap (~640,000 chars) |

Above `OUTLINE_DIRECT_MAX_CHARS`, summarize by map-reduce:

1. Batch `fileContent` at `OUTLINE_BATCH_CHARS`, preferring the `Page N:` markers
   the PDF parser already emits as batch boundaries so a batch does not straddle
   pages mid-sentence.
2. Summarize each batch into topics.
3. One consolidation call merges the batch topic lists, collapsing duplicates.

**Coverage is capped at `OUTLINE_MAX_BATCHES`.** Past that, summarization stops
and the *code* — not the model — appends a deterministic sentence to `notes`
naming how many characters of how many were covered, so the objective model
knows its view is partial and the instructor can be told. A 500-page textbook is
roughly 375,000 input tokens if summarized whole (about $0.90); the cap bounds a
pathological upload without affecting anything of normal size.

### 7. Invalidation

- **Content changed:** the non-`TITLE_ONLY_UPDATE_TYPES` update path already
  deletes and re-adds RAG documents; it clears `outline` in the same place.
  Title-only edits do not invalidate.
- **Prompt changed:** the summarization prompt follows the existing
  `settings?.prompts?.X || DEFAULT_PROMPTS.X` pattern, so an instructor can edit
  it. `outlinePromptHash` is compared on read and a mismatch regenerates.
  Without this, editing the prompt would visibly do nothing — a confusing bug.
- **Model changed:** `outlineModel` mismatch regenerates, for the same reason.

### 8. Error handling

| Case | Behaviour |
|---|---|
| Summarization fails at upload | Logged, upload succeeds, outline stays absent; the lazy path retries on first use |
| Summarization fails during objective generation | Whole request falls back to RAG retrieval |
| `fileContent` is empty or missing | No outline; falls back to RAG, which reproduces today's behaviour including the existing "No content found" 400 |
| Stored outline fails schema validation | Treated as absent and regenerated |
| Material exceeds the batch cap | Partial outline, truncation recorded in `notes` |

### 9. Testing

`tests/unit/material-outline.service.test.js`, with a mocked database and LLM:

- cache hit: a second call does not re-invoke the LLM
- absent outline generates, stores, and returns
- content update clears the stored outline
- prompt-hash mismatch regenerates; matching hash does not
- model mismatch regenerates
- map-reduce batches oversized content and issues one consolidation call
- batch cap produces a partial outline with truncation noted
- malformed stored outline is treated as absent
- generation failure propagates as a typed error the callers can distinguish

`tests/unit/objective-generation-prompt.controller.test.js` (extending the
existing file):

- outlines present → prompt contains `### MATERIAL:` blocks and no RAG call is made
- outline unavailable → falls back to RAG retrieval and still produces a prompt
- prompt keeps carrying the sourceIds the auto prompt expects

## Consequences

- Generation cost drops sharply after the first read of a material: roughly
  50,000 input tokens per generation today, versus a few thousand to read a
  cached outline. Break-even lands around the first or second generation, and
  regenerating becomes roughly an order of magnitude cheaper.
- Objective quality is **expected** to improve, because coverage replaces an
  arbitrary similarity ranking. This is not measured. The case for the change
  rests on amortized cost and removing a structural mismatch; treat quality as a
  likely bonus rather than a claim.
- Multi-material objectives get simpler: three outlines are small and inherently
  balanced, so per-material quotas, crowd-out, and context truncation stop
  applying to this path entirely.
- This is the third revision of the objective-generation retrieval path in quick
  succession. The per-material fan-out built immediately before it remains fully
  in use by question generation, but its objective-generation half becomes
  fallback-only.
