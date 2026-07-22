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

// Map an imported question doc to the payload shape /api/question/save expects.
// The meta objective is intentionally omitted — the server derives it from the
// chosen granular's parent. Server-managed fields (_id, courseId, timestamps,
// objective names) are dropped. Imported questions land as drafts for review.
export function toSavePayload(question, granularObjectiveId) {
  const type = String(question.questionType || question.type || "").toLowerCase();
  const payload = {
    title: String(question.title || "").trim(),
    stem: String(question.stem || "").trim(),
    stemImages: Array.isArray(question.stemImages) ? question.stemImages : [],
    questionType: type,
    bloom: question.bloom || question.bloomLevel || "",
    granularObjectiveId,
    status: "Draft",
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
