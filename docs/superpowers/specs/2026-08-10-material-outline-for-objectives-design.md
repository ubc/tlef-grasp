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
- Make the summary **visible and editable**, so a thin or wrong one is an
  instructor-fixable problem rather than an invisible cause of bad objectives.
- Never make a user wait on summarization inside a request they didn't
  associate with it.

## Non-goals

- Changing question generation. Retrieval is the correct tool there — it looks
  for content matching one specific granular objective — and it keeps the
  per-material fan-out unchanged.
- Replacing `fileContent`. The outline is derived data, stored alongside it.
- Merging instructor edits with regenerated content. See §5.
- Improving the chunker or chunk metadata. Separate concerns, separately scoped.
- Trimming `fileContent` from the materials list payload. Real and adjacent, but
  pre-existing and independent. See §10.

## Design

### 1. What gets stored

A **structured topic list**, not prose. The codebase already generates
structured output against JSON schemas (`OBJECTIVES_SCHEMA`,
`IMAGE_DESCRIPTION_SCHEMA`), and an enumerable topic list maps onto "generate
objectives covering this material" far better than a paragraph, which would have
to be re-parsed by the objective model to be useful. It is also far easier for an
instructor to skim, which §5 depends on.

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
| `outlinePromptHash` | First 16 hex chars of the SHA-256 of the prompt template used |
| `outlineSource` | `'generated'` or `'edited'` — whether an instructor has modified it |
| `outlineEditedAt` | When it was last edited, absent when never |

`fileContent` is never modified and remains the source of truth, so a thin or
wrong outline is always recoverable by regenerating.

### 2. One entry point

`src/services/material-outline.js` exposes:

```js
generateOutline(sourceId)         // → outline object; always (re)generates and stores
getOutline(sourceId)              // → stored outline or null; never generates
saveOutline(sourceId, outline)    // → validates and stores an instructor edit
```

Splitting these two is deliberate and load-bearing. The single
`getOrCreateOutline` of an earlier draft made it impossible to call the cheap
read path without risking an expensive generation, which is precisely the trap
that put a multi-second LLM call inside a user's objective-generation click.
Generation is now only ever invoked explicitly.

Invalidation, map-reduce batching, and persistence live behind these calls. The
module depends on the database and the LLM, not on the RAG service.

### 3. When outlines are created

**At upload, best-effort.** After `saveMaterial` has stored `fileContent`, call
`generateOutline` guarded so a failure logs and continues. The upload path
already holds its request open through LiteParse OCR and, for PPTX, one vision
call per slide, so it already tolerates long work and users already expect
uploads to take a while. Losing a successfully parsed and stored material
because its summary failed would be a bad trade, so the call must never
propagate.

**On explicit instructor request,** from the materials page (§5).

**Never inside objective generation.** If an outline is missing there, the
request falls back to retrieval (§6). Generating on demand in that request would
mean every instructor's first objective generation on every pre-existing
material was the slow one — not an edge case but the entire rollout experience.

### 4. Objective generation path

For each of the ≤3 selected materials, read its outline and render one block,
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

### 5. Materials page: view, edit, and regenerate

Each material on the course materials page exposes its outline.

- **Outline present:** a button opens a modal rendering the topic list and any
  notes, with **Edit**, **Regenerate**, and — when edited — a marker showing an
  instructor has modified it.
- **Outline absent:** the card flags it — this material will fall back to
  retrieval for objective generation — and offers **Generate outline**.
- **While generating:** the action shows progress and is disabled. A large
  material takes a while; this is acceptable because the instructor pressed the
  button, and a failure is recoverable by pressing it again rather than being a
  mystery hang somewhere else.

This replaces the backfill script an earlier draft needed. Instructors self-serve
on the materials that matter to them, so there is no bulk LLM spend and no
migration tooling.

**Editing.** Topic titles and key points are editable — add, remove, reorder,
rewrite. Saving sets `outlineSource: 'edited'` and stamps `outlineEditedAt`.

`notes` is **not** editable. It carries model-reported caveats and the
system-generated truncation sentence from §8, so it is state about how the
outline was produced rather than content the instructor authored.

**One rule keeps this simple: the edit wins until an explicit regeneration.**
Instructor edits are never merged with fresh model output — merging is what would
demand versioning and conflict resolution. Pressing **Regenerate** on an edited
outline warns that the edits will be discarded and requires confirmation.
Regeneration is therefore also how you "revert to generated", so no separate
revert affordance and no second stored copy is needed.

Edits are validated server-side: at least one topic, every topic has a non-empty
title, key points are non-empty after trimming, and topic count, key-point count,
and total length are capped so an outline cannot grow larger than the material it
summarizes.

**Why this matters.** The chief risk of summarizing is that a thin or skewed
outline silently degrades every objective generated from it, with no signal to
the instructor. Making it readable converts that from an invisible failure into
an inspectable one, and making it editable means the fix is deterministic and
free: bad objectives → read the outline → correct it directly, rather than
regenerating and hoping for a better roll.

### 6. Fallback

If an outline is missing for **any** selected material, the whole request falls
back to today's RAG retrieval path and logs the reason. Per-material fallback
would mix outline and chunk context for marginal benefit; whole-request
behaviour is predictable and easier to reason about when diagnosing a bad
generation.

This is not a degradation — it is exactly today's behaviour, so a material
without an outline generates objectives no worse than it does now.
`RAG_OBJECTIVE_CHUNK_LIMIT` therefore survives, and `.env.example` documents it
as governing the fallback path only.

### 7. API

| Route | Purpose |
|---|---|
| `GET /api/material/:sourceId/outline` | Fetch the stored outline, or 404 when absent |
| `POST /api/material/:sourceId/outline` | Generate or regenerate, returning the new outline |
| `PUT /api/material/:sourceId/outline` | Save an instructor edit after validation |

`GET /api/material/course/:courseId` gains a computed **`hasOutline`** boolean
per material and **must not include the `outline` field itself**. The list is
already oversized (§10); shipping every material's full topic list to render a
button would repeat that mistake. The modal fetches one outline on demand.

All three routes carry the same gating as other generation endpoints:
`hasStaffAccessInCourse`, plus `assertCoInstructorPermission` and
`assertTaPermission` under the existing `QUESTION_GENERATION` key. A dedicated
permission key would be cleaner but requires a settings migration, which is not
worth it for this.

### 8. Large materials

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
knows its view is partial and the instructor sees it in the modal. A 500-page
textbook is roughly 375,000 input tokens if summarized whole (about $0.90); the
cap bounds a pathological upload without affecting anything of normal size.

### 9. Invalidation

- **Content changed:** the non-`TITLE_ONLY_UPDATE_TYPES` update path already
  deletes and re-adds RAG documents; it clears `outline` in the same place, so
  the card shows the material as un-outlined until regenerated. Title-only edits
  do not invalidate.
- **Prompt changed:** the summarization prompt follows the existing
  `settings?.prompts?.X || DEFAULT_PROMPTS.X` pattern, so an instructor can edit
  it. `outlinePromptHash` is compared on read; a mismatch reports the outline as
  stale so it can be regenerated. Without this, editing the prompt would visibly
  do nothing — a confusing bug.
- **Model changed:** `outlineModel` mismatch reports stale, for the same reason.
  Note this means switching `LLM_PROVIDER` between Ollama and OpenAI marks every
  outline stale, which is intended: a summary from a small local model should not
  silently back production objectives.

Staleness marks, it does not auto-regenerate — consistent with §3.

**Edited outlines never go stale.** Once `outlineSource` is `'edited'`, the
prompt and model that originally produced it are no longer what the content
reflects, so comparing against them is meaningless. The instructor owns it, and
nagging them to regenerate would invite discarding their own edits.

A **content** change still clears an edited outline, since the edits described
material that no longer exists. That is a genuine loss of instructor work, so the
edit UI should say plainly that outlines are tied to the material's current
content.

### 10. Adjacent, deliberately out of scope

`getCourseMaterials` runs an unprojected `find()`, so the materials list ships
every material's entire `fileContent` to the browser — the full parsed text of
every PDF in the course, on every load of the materials page and now also
wherever `useCourseMaterials` is used. The client only reads `fileContent` for
**text** and **link** materials, where it is the pasted text or a URL and is
tiny; for PDFs and uploaded files it is never read and is by far the largest.

Stripping it for those types is a small contained fix, but it is pre-existing
and unrelated to outlines. This spec only requires that `outline` not be added
to that payload (§7).

### 11. Error handling

| Case | Behaviour |
|---|---|
| Summarization fails at upload | Logged, upload succeeds, outline absent; the card flags it and offers generation |
| Outline missing during objective generation | Whole request falls back to RAG retrieval; no generation attempted |
| `POST outline` fails | 500 with a message the modal surfaces; nothing stored; button remains available to retry |
| `fileContent` empty or missing | `POST outline` returns 400 — there is nothing to summarize; objective generation falls back to RAG, reproducing today's "No content found" 400 |
| `PUT outline` body fails validation | 400 naming the offending field; nothing stored; the modal keeps the instructor's unsaved text so the edit is not lost |
| `PUT outline` on a material with no outline | 400 — editing presupposes something to edit; generate first |
| Stored outline fails schema validation | Reported as absent, so the card offers regeneration rather than rendering garbage |
| Material exceeds the batch cap | Partial outline stored, truncation recorded in `notes` and visible in the modal |
| `GET outline` for a material with none | 404, so the client can distinguish "none" from a transport failure |

### 12. Testing

`tests/unit/material-outline.service.test.js`, with a mocked database and LLM:

- `getOutline` never invokes the LLM, whether an outline exists or not
- `generateOutline` stores outline, timestamp, model, and prompt hash
- content update clears the stored outline
- prompt-hash mismatch reports stale; matching hash does not
- model mismatch reports stale
- map-reduce batches oversized content and issues one consolidation call
- batch cap produces a partial outline with truncation noted in `notes`
- malformed stored outline is reported as absent
- empty `fileContent` is rejected rather than producing an empty outline
- `saveOutline` sets `outlineSource: 'edited'` and `outlineEditedAt`, and leaves
  `notes` at its stored value rather than accepting one from the caller
- `saveOutline` rejects: zero topics, a blank title, blank key points, and each
  cap (topic count, key-point count, total length)
- an edited outline is not reported stale on prompt-hash or model mismatch
- a content update clears an edited outline just as it clears a generated one
- `generateOutline` on an edited outline overwrites it and resets
  `outlineSource` to `'generated'`

`tests/unit/material-outline.route.test.js`:

- `GET` returns the outline; 404 when absent
- `POST` generates and returns; 400 on empty `fileContent`
- `PUT` stores a valid edit; 400 on an invalid body; 400 when no outline exists
- `PUT` cannot smuggle in `notes`, `outlineModel`, or `outlinePromptHash`
- all three enforce staff access and the co-instructor/TA permission checks
- the course materials list includes `hasOutline` and **excludes** `outline`

`tests/unit/objective-generation-prompt.controller.test.js` (extending the
existing file):

- outlines present → prompt contains `### MATERIAL:` blocks and no RAG call is made
- an outline missing → falls back to RAG retrieval and still produces a prompt
- objective generation never triggers outline generation
- the prompt keeps carrying the sourceIds the auto prompt expects

## Consequences

- Generation cost drops sharply once a material has an outline: roughly 50,000
  input tokens per generation today, versus a few thousand to read a cached
  outline. Regenerating objectives becomes roughly an order of magnitude
  cheaper.
- Objective quality is **expected** to improve, because coverage replaces an
  arbitrary similarity ranking. This is not measured. The case for the change
  rests on amortized cost, removing a structural mismatch, and making the
  summary inspectable and correctable; treat the model-driven quality gain as a
  likely bonus rather than a claim.
- Editing gives instructors direct control over what objectives are generated
  from, which is a stronger guarantee than any prompt change: a corrected outline
  is deterministic and costs nothing, whereas regenerating is nondeterministic and
  spends tokens. It also means a poor summarization model is no longer a hard
  ceiling on objective quality.
- Rollout is gradual and instructor-driven. New uploads get outlines
  automatically; existing materials keep behaving exactly as they do today until
  someone presses the button. Nothing regresses and nothing needs migrating.
- Multi-material objectives get simpler: three outlines are small and inherently
  balanced, so per-material quotas, crowd-out, and context truncation stop
  applying to this path entirely.
- This is the third revision of the objective-generation retrieval path in quick
  succession. The per-material fan-out built immediately before it remains fully
  in use by question generation, but its objective-generation half becomes
  fallback-only.
