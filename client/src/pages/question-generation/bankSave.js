import { buildQuestionPayload } from "./generationApi";

// Saves the wizard's questions to the Question Bank.
//
// A saved question keeps its bank id (_id) and a snapshot of what was saved
// (bankSnapshot). Only questions edited since then are re-sent, so changes
// made in the Question Bank meanwhile (an approval, an orphaned state) are
// not overwritten.

// Never sent in an update: re-sending the objective would re-attach a
// deleted one.
const CREATE_ONLY_FIELDS = ["granularObjectiveId", "learningObjectiveId", "by"];

export const questionSnapshot = (question) => JSON.stringify(buildQuestionPayload(question));

// No snapshot (e.g. an old draft) counts as edited, so no edit is lost.
export const hasUnsavedEdits = (question) =>
  !question.bankSnapshot || questionSnapshot(question) !== question.bankSnapshot;

// Questions never saved or edited since their last save.
export const countUnsavedQuestions = (questionGroups) =>
  questionGroups
    .flatMap((group) => group.los.flatMap((lo) => lo.questions))
    .filter((q) => !q._id || hasUnsavedEdits(q)).length;

// Status is sent only if it was toggled since the last save, so an unrelated
// edit cannot undo an approval made in the Question Bank.
export function buildUpdatePayload(question) {
  const payload = buildQuestionPayload(question);
  for (const field of CREATE_ONLY_FIELDS) delete payload[field];
  let savedStatus;
  try {
    savedStatus = JSON.parse(question.bankSnapshot).status;
  } catch {
    savedStatus = undefined;
  }
  if (payload.status === savedStatus || !question.bankSnapshot) delete payload.status;
  return payload;
}

// Explains questions the quiz did not take.
export function quizSkipNote({ alreadyInQuizCount = 0, ineligibleCount = 0 } = {}) {
  const parts = [];
  if (ineligibleCount > 0) {
    const plural = ineligibleCount !== 1;
    parts.push(
      `${ineligibleCount} question${plural ? "s were" : " was"} skipped because ` +
        `${plural ? "they have" : "it has"} no valid learning objective`
    );
  }
  if (alreadyInQuizCount > 0) {
    parts.push(
      `${alreadyInQuizCount} ${alreadyInQuizCount !== 1 ? "were" : "was"} already in the quiz`
    );
  }
  return parts.length > 0 ? ` ${parts.join("; ")}.` : "";
}

// An orphaned question is always Draft in the bank; the page copy follows.
const savedAsDraft = (q, _id) => {
  const draft = { ...q, status: "Draft" };
  return { _id, status: "Draft", bankSnapshot: questionSnapshot(draft) };
};

const isOrphanedApproval = (error) =>
  error.status === 409 && error.body?.code === "ORPHANED_APPROVAL_BLOCKED";

// If approval is refused because the objective was deleted, saves the edit
// without it. Resolves to "updated" or "orphaned".
async function updateQuestion(api, q, saved) {
  const payload = buildUpdatePayload(q);
  try {
    await api.put(`/api/question/${q._id}`, payload);
  } catch (error) {
    if (!isOrphanedApproval(error)) throw error;
    const { status: _refused, ...withoutStatus } = payload;
    await api.put(`/api/question/${q._id}`, withoutStatus);
    saved.set(q.id, savedAsDraft(q, q._id));
    return "orphaned";
  }
  saved.set(q.id, { _id: q._id, bankSnapshot: questionSnapshot(q) });
  return "updated";
}

// Updates edited questions and creates new ones, plus any deleted from the
// bank since they were saved.
//
// Returns:
//   saved         wizard id -> { _id, bankSnapshot[, status] } to record on the page
//   ids           bank id per page question, in order (null if its save failed)
//   savedCount    questions now in the bank
//   orphanedCount questions saved as Draft because their objective was deleted
//   error         first update failure; nothing is created after one
export async function saveQuestionsToBank({ api, courseId, pageQuestions }) {
  const saved = new Map();
  const deleted = [];
  const failures = [];
  let orphanedCount = 0;

  // Unchanged questions are never sent, so ask which ones were deleted.
  const previouslySaved = pageQuestions.filter((q) => q._id);
  if (previouslySaved.length > 0) {
    const { existingIds = [] } = await api.post("/api/question/existing", {
      courseId,
      questionIds: previouslySaved.map((q) => q._id),
    });
    const existing = new Set(existingIds.map(String));
    deleted.push(...previouslySaved.filter((q) => !existing.has(String(q._id))));
  }
  const goneIds = new Set(deleted.map((q) => q.id));

  await Promise.all(
    pageQuestions
      .filter((q) => q._id && !goneIds.has(q.id) && hasUnsavedEdits(q))
      .map((q) =>
        updateQuestion(api, q, saved)
          .then((outcome) => {
            if (outcome === "orphaned") orphanedCount += 1;
          })
          .catch((error) => {
            if (error.status === 404) deleted.push(q);
            else failures.push(error);
          })
      )
  );

  if (failures.length > 0) {
    return {
      saved,
      ids: pageQuestions.map((q) => q._id || null),
      savedCount: 0,
      orphanedCount,
      error: failures[0],
    };
  }

  const toCreate = [...pageQuestions.filter((q) => !q._id), ...deleted];
  const data = toCreate.length
    ? await api.post("/api/question/save", {
        courseId,
        questions: toCreate.map(buildQuestionPayload),
      })
    : {};
  const orphanedIds = new Set(data.orphanedIds || []);
  toCreate.forEach((q, i) => {
    const newId = data.questionIdsByIndex?.[i];
    if (!newId) return;
    if (orphanedIds.has(newId)) {
      saved.set(q.id, savedAsDraft(q, newId));
      orphanedCount += 1;
    } else {
      saved.set(q.id, { _id: newId, bankSnapshot: questionSnapshot(q) });
    }
  });

  const createdIds = new Set(toCreate.map((q) => q.id));
  return {
    saved,
    ids: pageQuestions.map((q) =>
      createdIds.has(q.id) ? saved.get(q.id)?._id || null : q._id
    ),
    savedCount: pageQuestions.length - toCreate.length + (data.savedCount || 0),
    orphanedCount,
  };
}

export function orphanedNote(count) {
  if (!count) return "";
  const plural = count !== 1;
  return (
    ` ${count} ${plural ? "were" : "was"} saved as Draft because ` +
    `${plural ? "their" : "its"} learning objective was deleted.`
  );
}
