// Shared helpers for importing questions from a GRASP JSON export (question-bank
// export or quiz export — both carry a top-level `questions` array). Kept
// framework-free so both the Add-Question import step and the Create-Quiz import
// step can reuse the same parsing, objective matching, and save-payload mapping.

// Parse an uploaded export file. Accepts the object form ({ questions, quiz,
// objectives }) or a bare array of questions. Throws on anything else so the UI
// can surface a clear error.
export function parseQuestionsFile(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  const questions = Array.isArray(data) ? data : data?.questions;
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error("No questions found in that file.");
  }
  return {
    questions,
    quiz: (!Array.isArray(data) && data?.quiz) || null,
    objectives: (!Array.isArray(data) && data?.objectives) || [],
  };
}

// Flatten the course's detailed objectives (meta → granular) into a single list
// for matching and for the picker dropdown.
export function flattenGranulars(detailedObjectives) {
  const flat = [];
  (detailedObjectives || []).forEach((meta) => {
    (meta.granular || []).forEach((granular) => {
      flat.push({
        id: granular._id ? String(granular._id) : String(granular.id || ""),
        name: granular.name || granular.text || "",
        metaId: meta.id,
        metaName: meta.name || "",
      });
    });
  });
  return flat;
}

// Resolve an imported question to one of the course's granular objectives: by id
// first (a same-course round-trip), then by case-insensitive name (a cross-course
// import). Returns the matched granular id, or "" when nothing matches and the
// user must pick one.
export function matchGranular(question, flatGranulars) {
  const importedId = question.granularObjectiveId
    ? String(question.granularObjectiveId)
    : "";
  if (importedId) {
    const byId = flatGranulars.find((g) => g.id === importedId);
    if (byId) return byId.id;
  }
  const importedName = (question.granularObjectiveName || "").trim().toLowerCase();
  if (importedName) {
    const byName = flatGranulars.find(
      (g) => g.name.trim().toLowerCase() === importedName
    );
    if (byName) return byName.id;
  }
  return "";
}

// The student-facing text used to identify a question in the review list.
export function importQuestionLabel(question) {
  return String(question.title || question.stem || question.question || "").trim();
}

const VALID_STATUSES = ["Draft", "Approved", "Flagged"];

// Map an imported question doc to the payload shape /api/question/save expects.
// The meta objective is intentionally omitted — the server derives it from the
// chosen granular's parent. Server-managed fields (_id, courseId, timestamps,
// objective names) are dropped. Status defaults to "Draft" (bank import, so
// imports get reviewed); pass { preserveStatus: true } to keep the file's own
// status (quiz import, so an approved quiz round-trips into a working quiz).
export function toSavePayload(question, granularObjectiveId, { preserveStatus = false } = {}) {
  const type = String(question.questionType || question.type || "").toLowerCase();
  const status =
    preserveStatus && VALID_STATUSES.includes(question.status) ? question.status : "Draft";
  const payload = {
    title: String(question.title || "").trim(),
    stem: String(question.stem || "").trim(),
    stemImages: Array.isArray(question.stemImages) ? question.stemImages : [],
    questionType: type,
    bloom: question.bloom || question.bloomLevel || "",
    granularObjectiveId,
    status,
    options: question.options && typeof question.options === "object" ? question.options : {},
    correctAnswer: question.correctAnswer ?? "",
    acceptableAnswers: Array.isArray(question.acceptableAnswers)
      ? question.acceptableAnswers
      : [],
    openEndedSampleAnswer: question.openEndedSampleAnswer || "",
    openEndedGradingCriteria: question.openEndedGradingCriteria || "",
    calculationFormula: question.calculationFormula || "",
    calculationVariables: Array.isArray(question.calculationVariables)
      ? question.calculationVariables
      : [],
    calculationAnswerDecimals:
      question.calculationAnswerDecimals ?? 2,
    calculationAnswerTolerancePercent:
      question.calculationAnswerTolerancePercent ?? null,
  };
  return payload;
}

// --- Objectives carried by an imported file ---------------------------------
// An export's `objectives` array is [{ metaObjectiveId, metaObjectiveName,
// granularObjectives: [{ id, name }] }] (buildObjectivesSummary, src/controllers/
// question.js).

// Comparison rule for objective text, matching matchGranular's name branch.
export function normalizeObjectiveText(value) {
  return String(value ?? "").trim().toLowerCase();
}

// Bucket the file's objectives against the course's granulars, matching on text.
// Granular text is deduped across the whole file, so one text yields one granular
// however many metas carry it. Metas are keyed by normalized name, so file
// entries naming the same meta ("Thermo", "thermo ") land in one group — one
// write per parent, and one React key per group.
//
// Returns [{ metaName, metaKey, existingMetaId, granulars }], each granular
// { key, name, existingId }; existingId is set when the course already has that
// text, existingMetaId when it already has that parent — by id if the file's
// parent is still in this course, otherwise by name.

// Parent name for granulars the file left unparented. Resolved like any other,
// so repeat imports reuse the one they created rather than adding another.
export const UNGROUPED_META_NAME = "Ungrouped objectives";

export function bucketImportedObjectives(fileObjectives, flatGranulars) {
  const ownedById = new Map();
  const ownedByText = new Map();
  const metaIdByName = new Map();
  const metaNameById = new Map();

  (flatGranulars || []).forEach((g) => {
    if (g.id) ownedById.set(String(g.id), g);
    const text = normalizeObjectiveText(g.name);
    if (text && !ownedByText.has(text)) ownedByText.set(text, g);
    const meta = normalizeObjectiveText(g.metaName);
    if (meta && !metaIdByName.has(meta)) metaIdByName.set(meta, g.metaId);
    if (g.metaId) metaNameById.set(String(g.metaId), g.metaName || "");
  });

  const seen = new Set();
  const byMetaKey = new Map();

  (fileObjectives || []).forEach((meta) => {
    const metaName = String(meta?.metaObjectiveName || "").trim() || UNGROUPED_META_NAME;
    const metaKey = normalizeObjectiveText(metaName);

    const granulars = (meta?.granularObjectives || [])
      .map((g) => ({
        id: String(g?.id || g?._id || ""),
        name: String(g?.name || g?.text || "").trim(),
      }))
      .filter(({ name }) => {
        const key = normalizeObjectiveText(name);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map(({ id, name }) => {
        // Id first, then text — the order matchGranular resolves a question in,
        // so the checklist and the question rows agree about what already
        // exists. Keyed on the file's text either way, since that is what a
        // question names. The course's own text is shown when the id resolves.
        const key = normalizeObjectiveText(name);
        const owned = ownedById.get(id) || ownedByText.get(key) || null;
        return { key, name: owned?.name || name, existingId: owned?.id || null };
      });

    if (granulars.length === 0) return;

    // Prefer the id the file carries, falling back to the name. On a same-course
    // round trip the parent may have been renamed since the export, and matching
    // only its old name would create a second copy of it alongside the renamed
    // one. An id from another course is not in this course, so it falls through.
    const fileMetaId = String(meta?.metaObjectiveId || "");
    const existingMetaId =
      (metaNameById.has(fileMetaId) && fileMetaId) || metaIdByName.get(metaKey) || null;

    const group = byMetaKey.get(metaKey);
    if (group) {
      group.existingMetaId = group.existingMetaId || existingMetaId;
      group.granulars.push(...granulars);
      return;
    }
    byMetaKey.set(metaKey, {
      // The course's own name for a parent resolved by id; the file's copy of it
      // may be a rename behind.
      metaName: metaNameById.get(existingMetaId) || metaName,
      metaKey,
      existingMetaId,
      granulars,
    });
  });

  return [...byMetaKey.values()];
}

// Keys of every granular the course does not already have.
export function creatableKeys(groups) {
  return (groups || []).flatMap((group) =>
    group.granulars.filter((g) => !g.existingId).map((g) => g.key)
  );
}

// Of the creatable granulars, the ones an unmatched question actually names.
// A same-course round trip whose LO was renamed after export carries the old
// name: it matches nothing, so it would be offered as "new" and checked, and
// the import would create an LO no question uses. Those stay unchecked.
export function neededKeys(groups, questions, flatGranulars) {
  const wanted = new Set(
    (questions || [])
      .filter((question) => !matchGranular(question, flatGranulars || []))
      .map(importedGranularKey)
  );
  return creatableKeys(groups).filter((key) => wanted.has(key));
}

// Split the checked granulars into the two operations they need:
//   creates → POST /api/objective, a new meta with its granulars
//   appends → POST /api/objective/:id/granular, which inserts under an existing
//             meta and leaves its current children alone. Not PUT /:id: that
//             replaces the granular set, so appending through it had to resend
//             the siblings, clearing their settings and deleting any sibling
//             added since this list was loaded.
export function planObjectiveCreations(groups, checkedKeys) {
  const checked = checkedKeys instanceof Set ? checkedKeys : new Set(checkedKeys || []);
  const creates = [];
  const appends = [];

  (groups || []).forEach((group) => {
    const added = group.granulars
      .filter((g) => !g.existingId && checked.has(g.key))
      .map((g) => ({ text: g.name }));
    if (added.length === 0) return;

    if (group.existingMetaId) {
      appends.push({
        objectiveId: group.existingMetaId,
        metaName: group.metaName,
        granularObjectives: added,
      });
    } else {
      creates.push({ name: group.metaName, granularObjectives: added });
    }
  });

  return { creates, appends };
}

// Bucketing key for the objective a question arrived pointing at.
export function importedGranularKey(question) {
  return normalizeObjectiveText(question?.granularObjectiveName);
}

// True when the row matched an objective, or names one queued for creation.
export function isRowResolved(row, checkedKeys) {
  const key = row.granularId ? "" : importedGranularKey(row.question);
  return Boolean(row.granularId || (key && checkedKeys?.has(key)));
}
