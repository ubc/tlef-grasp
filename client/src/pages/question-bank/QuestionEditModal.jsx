import { useEffect, useState } from "react";
import { QUESTION_TYPES } from "../../lib/constants";
import { normalizeQuestionTypeKey, QUESTION_TYPE_CHIP_CLASSES } from "../../lib/utils";
import { useQuestionDetail, useUpdateQuestion } from "../../hooks/useQuestions";
import Modal from "../../components/ui/Modal";
import { useToast } from "../../components/ui/Toast";
import QuestionImageField from "../../components/QuestionImageField";
import McOptionEditor from "../../components/McOptionEditor";
import AutoHeightTextarea from "../../components/AutoHeightTextarea";
import CalculationToleranceFields from "../../components/CalculationToleranceFields";
import {
  optionRowsOf,
  optionRowsToObject,
  optionRowsError,
  MC_OPTION_KEYS,
} from "../../lib/mcOptions";
import {
  toleranceToForm,
  toleranceFromForm,
  tolerancePayload,
  stemPlaceholderNames,
} from "../../lib/calculationTolerance";

const inputClass =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none read-only:cursor-not-allowed read-only:bg-gray-100";
const labelClass = "mb-1 block text-sm font-semibold text-ink";

function TypeChip({ type, label }) {
  return (
    <span
      className={`mb-3 inline-block rounded-full px-3 py-1 text-xs font-semibold ${QUESTION_TYPE_CHIP_CLASSES[type]}`}
    >
      {label}
    </span>
  );
}

// API question -> editable form state, per question type.
function buildFormState(question) {
  const qType = normalizeQuestionTypeKey(question.questionType || question.type);

  if (qType === QUESTION_TYPES.FILL_IN_THE_BLANK) {
    const canonical =
      question.correctAnswer != null ? String(question.correctAnswer).trim() : "";
    let acceptable = Array.isArray(question.acceptableAnswers)
      ? question.acceptableAnswers.map((a) => String(a).trim()).filter(Boolean)
      : [];
    if (acceptable.length === 0 && canonical) acceptable = [canonical];
    return {
      questionType: qType,
      title: question.title || question.stem || "",
      stem: question.stem || question.title || "",
      stemImages: question.stemImages || (question.stemImage ? [question.stemImage] : []),
      correctAnswer: canonical,
      acceptableAnswers: acceptable.join("\n"),
    };
  }

  if (qType === QUESTION_TYPES.CALCULATION) {
    const dec =
      question.calculationAnswerDecimals !== undefined &&
      question.calculationAnswerDecimals !== null
        ? parseInt(question.calculationAnswerDecimals, 10)
        : 2;
    return {
      questionType: qType,
      title: question.title || "",
      stem: question.stem || "",
      stemImages: question.stemImages || (question.stemImage ? [question.stemImage] : []),
      calculationFormula: (question.calculationFormula || "").trim(),
      calculationVariables: JSON.stringify(
        Array.isArray(question.calculationVariables)
          ? question.calculationVariables
          : [],
        null,
        2
      ),
      calculationAnswerDecimals: Number.isFinite(dec) ? String(dec) : "2",
      ...toleranceToForm(question),
    };
  }

  if (qType === QUESTION_TYPES.OPEN_ENDED) {
    return {
      questionType: qType,
      title: question.title || "",
      stem: question.stem || question.title || "",
      stemImages: question.stemImages || (question.stemImage ? [question.stemImage] : []),
      openEndedSampleAnswer: String(question.openEndedSampleAnswer || "").trim(),
      openEndedGradingCriteria: String(question.openEndedGradingCriteria || "").trim(),
    };
  }

  // Rows for whatever options the question has (two to eight, issue #144).
  const options = optionRowsOf(question.options);
  let correct = question.correctAnswer;
  if (typeof correct === "number") {
    correct = MC_OPTION_KEYS[correct] || "A";
  } else if (typeof correct === "string") {
    correct = correct.toUpperCase();
  } else {
    correct = "A";
  }
  if (!options.some((option) => option.id === correct)) correct = options[0].id;
  return {
    questionType: QUESTION_TYPES.MULTIPLE_CHOICE,
    title: question.title || question.stem || "",
    stem: question.stem || question.title || "",
    stemImages: question.stemImages || (question.stemImage ? [question.stemImage] : []),
    options,
    correctAnswer: correct,
  };
}

// View/edit modal for a single question, loaded fresh from the API.
export default function QuestionEditModal({ questionId, canEdit, courseId, onClose }) {
  const showToast = useToast();
  const [form, setForm] = useState(null);

  const { question, isPending: loading, error } = useQuestionDetail(questionId);
  const loadError = error?.message || null;

  useEffect(() => {
    if (question) setForm(buildFormState(question));
  }, [question]);

  const updateMutation = useUpdateQuestion(courseId, {
    onSuccess: () => {
      showToast("Question updated successfully", "success");
      onClose();
    },
    onError: (err) => {
      console.error("Error saving question:", err);
      showToast(err.message || "Failed to save question", "error");
    },
  });
  const saving = updateMutation.isPending;

  const set = (field) => (event) =>
    setForm((prev) => ({ ...prev, [field]: event.target.value }));

  const handleSave = () => {
    const title = form.title.trim();
    const stem = form.stem.trim();
    let updateData;

    if (form.questionType === QUESTION_TYPES.CALCULATION) {
      if (!title) return showToast("Topic title is required", "error");
      if (!stem) return showToast("Question template is required", "error");
      const formula = form.calculationFormula.trim();
      if (!formula) return showToast("Formula is required", "error");
      let variables;
      try {
        variables = JSON.parse(form.calculationVariables.trim() || "[]");
      } catch {
        return showToast("Variables must be valid JSON", "error");
      }
      // [] is a fixed-answer question: the formula is a constant and the
      // template must not ask for values nobody fills in.
      if (!Array.isArray(variables)) {
        return showToast("Variables must be a JSON array (use [] for a fixed answer)", "error");
      }
      if (variables.length === 0) {
        const stray = stemPlaceholderNames(stem);
        if (stray.length > 0) {
          return showToast(
            `The template uses {{${stray[0]}}} but has no variables — add the variable or remove the braces`,
            "error"
          );
        }
      }
      for (const v of variables) {
        if (!v || typeof v.name !== "string" || !v.name.trim()) {
          return showToast('Each variable needs a "name" string', "error");
        }
        const mn = Number(v.min);
        const mx = Number(v.max);
        if (!Number.isFinite(mn) || !Number.isFinite(mx) || mn > mx) {
          return showToast(`Invalid min/max for variable "${v.name}"`, "error");
        }
      }
      let dec = parseInt(form.calculationAnswerDecimals, 10);
      if (!Number.isFinite(dec)) dec = 2;
      dec = Math.max(0, Math.min(12, dec));
      const toleranceCheck = toleranceFromForm(form, variables.length);
      if (toleranceCheck.error) return showToast(toleranceCheck.error, "error");

      updateData = {
        title,
        stem,
        stemImages: form.stemImages || [],
        questionType: QUESTION_TYPES.CALCULATION,
        calculationFormula: formula,
        calculationVariables: variables,
        calculationAnswerDecimals: dec,
        ...tolerancePayload(toleranceCheck.tolerance),
        options: {},
        acceptableAnswers: [],
      };
    } else if (form.questionType === QUESTION_TYPES.OPEN_ENDED) {
      if (!title) return showToast("Topic title is required", "error");
      if (!stem) return showToast("Question prompt is required", "error");
      const sample = form.openEndedSampleAnswer.trim();
      const criteria = form.openEndedGradingCriteria.trim();
      if (!sample) {
        return showToast("Sample answer is required for open-ended questions", "error");
      }
      if (!criteria) {
        return showToast(
          "Grading criteria are required for open-ended questions",
          "error"
        );
      }
      updateData = {
        title,
        stem,
        stemImages: form.stemImages || [],
        questionType: QUESTION_TYPES.OPEN_ENDED,
        openEndedSampleAnswer: sample,
        openEndedGradingCriteria: criteria,
        options: {},
        acceptableAnswers: [],
        correctAnswer: "",
      };
    } else if (form.questionType === QUESTION_TYPES.FILL_IN_THE_BLANK) {
      if (!title) return showToast("Topic title is required", "error");
      if (!stem) return showToast("Question stem is required", "error");
      if (!stem.includes("_________")) {
        return showToast(
          "Stem must include exactly one blank: _________ (nine underscores)",
          "error"
        );
      }
      const correct = form.correctAnswer.trim();
      if (!correct) return showToast("Correct answer is required", "error");
      let acceptable = form.acceptableAnswers
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      if (acceptable.length === 0) acceptable = [correct];

      updateData = {
        title,
        stem,
        stemImages: form.stemImages || [],
        questionType: QUESTION_TYPES.FILL_IN_THE_BLANK,
        correctAnswer: correct,
        acceptableAnswers: acceptable,
        options: {},
      };
    } else {
      // Multiple choice
      if (!title && !stem) {
        return showToast("Question title or stem is required", "error");
      }
      const optionsError = optionRowsError(form.options);
      if (optionsError) return showToast(optionsError, "error");
      if (!form.options.some((opt) => opt.id === form.correctAnswer)) {
        return showToast("Select which option is the correct answer", "error");
      }
      updateData = {
        title: title || stem,
        stem: stem || title,
        stemImages: form.stemImages || [],
        questionType: QUESTION_TYPES.MULTIPLE_CHOICE,
        options: optionRowsToObject(form.options),
        correctAnswer: form.correctAnswer.toUpperCase(),
      };
    }

    updateMutation.mutate({ questionId, updates: updateData });
  };

  const readOnly = !canEdit;

  return (
    <Modal
      open
      onClose={onClose}
      title={canEdit ? "Edit question" : "View question"}
      wide
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-gray-50"
          >
            Cancel
          </button>
          {!readOnly && form && (
            <button
              type="button"
              disabled={saving}
              onClick={handleSave}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
          )}
        </>
      }
    >
      {loading || (!form && !loadError) ? (
        <div className="py-10 text-center text-muted">
          <i className="fas fa-spinner fa-spin mb-2 text-2xl" />
          <p>Loading question...</p>
        </div>
      ) : loadError ? (
        <div className="py-10 text-center text-danger">
          <i className="fas fa-exclamation-circle mb-2 text-2xl" />
          <p>Failed to load question details</p>
          <p className="text-xs text-muted">{loadError}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {readOnly && (
            <div className="rounded-lg border border-warning/60 bg-warning/10 px-4 py-3 text-sm text-yellow-800">
              <i className="fas fa-lock mr-2" />
              This question is approved and cannot be edited.
            </div>
          )}

          {question?.status === "Draft" && question.importWarnings?.length > 0 && (
            <div className="rounded-lg border border-warning/60 bg-warning/10 px-4 py-3 text-sm text-yellow-800">
              <p className="font-semibold">
                <i className="fas fa-triangle-exclamation mr-2" aria-hidden="true" />
                Imported from Canvas. Check before approving:
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-6">
                {question.importWarnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            </div>
          )}

          {form.questionType !== QUESTION_TYPES.MULTIPLE_CHOICE && (
            <TypeChip
              type={form.questionType}
              label={
                {
                  [QUESTION_TYPES.FILL_IN_THE_BLANK]: "Fill-in-the-blank",
                  [QUESTION_TYPES.CALCULATION]: "Calculation",
                  [QUESTION_TYPES.OPEN_ENDED]: "Open-ended",
                }[form.questionType]
              }
            />
          )}

          <div>
            <label htmlFor="qem-title" className={labelClass}>
              {form.questionType === QUESTION_TYPES.MULTIPLE_CHOICE
                ? "Question Title"
                : "Topic title"}
            </label>
            {/* The MC title is the prompt students see, which can run to
                several lines; other types' titles are short topic labels. */}
            {form.questionType === QUESTION_TYPES.MULTIPLE_CHOICE ? (
              <AutoHeightTextarea
                id="qem-title"
                value={form.title}
                onChange={set("title")}
                readOnly={readOnly}
                className={inputClass}
              />
            ) : (
              <input
                id="qem-title"
                type="text"
                value={form.title}
                onChange={set("title")}
                readOnly={readOnly}
                className={inputClass}
              />
            )}
          </div>

          <div>
            <label className={labelClass}>
              {form.questionType === QUESTION_TYPES.CALCULATION
                ? "Question template"
                : form.questionType === QUESTION_TYPES.OPEN_ENDED
                  ? "Question prompt"
                  : "Question Stem"}
            </label>
            <textarea
              rows={form.questionType === QUESTION_TYPES.OPEN_ENDED ? 6 : 4}
              value={form.stem}
              onChange={set("stem")}
              readOnly={readOnly}
              className={inputClass}
            />
            {form.questionType === QUESTION_TYPES.CALCULATION && (
              <p className="mt-1 text-xs text-muted">
                Use <code>{"{{variableName}}"}</code> placeholders matching the
                variables JSON below.
              </p>
            )}
            {((form.stemImages && form.stemImages.length > 0) || !readOnly) && (
              <div className="mt-2">
                <QuestionImageField
                  value={form.stemImages}
                  disabled={readOnly}
                  courseId={courseId}
                  onChange={(images) =>
                    setForm((prev) => ({ ...prev, stemImages: images }))
                  }
                />
              </div>
            )}
          </div>

          {form.questionType === QUESTION_TYPES.FILL_IN_THE_BLANK && (
            <>
              <div>
                <label className={labelClass}>Correct answer</label>
                <input
                  type="text"
                  value={form.correctAnswer}
                  onChange={set("correctAnswer")}
                  readOnly={readOnly}
                  placeholder="Canonical correct answer"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>
                  Acceptable answers{" "}
                  <span className="font-normal text-muted">(one per line; optional)</span>
                </label>
                <textarea
                  rows={4}
                  value={form.acceptableAnswers}
                  onChange={set("acceptableAnswers")}
                  readOnly={readOnly}
                  placeholder="Other accepted spellings or synonyms, one per line"
                  className={inputClass}
                />
              </div>
            </>
          )}

          {form.questionType === QUESTION_TYPES.CALCULATION && (
            <>
              <div>
                <label className={labelClass}>Formula (expr-eval syntax)</label>
                <textarea
                  rows={2}
                  value={form.calculationFormula}
                  onChange={set("calculationFormula")}
                  readOnly={readOnly}
                  placeholder="a * b"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>
                  Variables (JSON array){" "}
                  <span className="font-normal text-muted">
                    — <code>[]</code> for a fixed answer
                  </span>
                </label>
                <textarea
                  rows={8}
                  value={form.calculationVariables}
                  onChange={set("calculationVariables")}
                  readOnly={readOnly}
                  className={`${inputClass} font-mono`}
                />
              </div>
              <div>
                <label className={labelClass}>Answer decimal places (display)</label>
                <input
                  type="number"
                  min={0}
                  max={12}
                  step={1}
                  value={form.calculationAnswerDecimals}
                  onChange={set("calculationAnswerDecimals")}
                  readOnly={readOnly}
                  className={`${inputClass} max-w-32`}
                />
              </div>
              <CalculationToleranceFields
                form={form}
                setForm={setForm}
                readOnly={readOnly}
                inputClass={inputClass}
                labelClass={labelClass}
                hintClass="mt-1 text-xs text-muted"
                idPrefix="qem-calc"
              />
            </>
          )}

          {form.questionType === QUESTION_TYPES.OPEN_ENDED && (
            <>
              <div>
                <label className={labelClass}>
                  Sample answer{" "}
                  <span className="font-normal text-muted">(shown after submit)</span>
                </label>
                <textarea
                  rows={6}
                  value={form.openEndedSampleAnswer}
                  onChange={set("openEndedSampleAnswer")}
                  readOnly={readOnly}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>
                  Grading criteria{" "}
                  <span className="font-normal text-muted">(shown after submit)</span>
                </label>
                <textarea
                  rows={6}
                  value={form.openEndedGradingCriteria}
                  onChange={set("openEndedGradingCriteria")}
                  readOnly={readOnly}
                  className={inputClass}
                />
              </div>
            </>
          )}

          {form.questionType === QUESTION_TYPES.MULTIPLE_CHOICE && (
            <div>
              <label className={labelClass}>Options</label>
              <McOptionEditor
                options={form.options}
                correctAnswer={form.correctAnswer}
                onChange={({ options, correctAnswer }) =>
                  setForm((prev) => ({ ...prev, options, correctAnswer }))
                }
                readOnly={readOnly}
                radioName="question-correct-answer"
                inputClass={inputClass}
                courseId={courseId}
              />
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
