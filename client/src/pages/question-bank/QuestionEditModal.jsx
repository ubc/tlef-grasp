import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { QUESTION_TYPES } from "../../lib/constants";
import { normalizeQuestionTypeKey, QUESTION_TYPE_CHIP_CLASSES } from "../../lib/utils";
import Modal from "../../components/ui/Modal";
import { useToast } from "../../components/ui/Toast";

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

// View/edit modal for a single question, loaded fresh from the API.
export default function QuestionEditModal({ questionId, canEdit, onClose, onSaved }) {
  const showToast = useToast();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    api
      .get(`/api/question/${questionId}`)
      .then((data) => {
        if (cancelled) return;
        if (!data.success || !data.question) throw new Error("Question not found");
        const question = data.question;
        const qType = normalizeQuestionTypeKey(question.questionType || question.type);

        if (qType === QUESTION_TYPES.FILL_IN_THE_BLANK) {
          const canonical =
            question.correctAnswer != null ? String(question.correctAnswer).trim() : "";
          let acceptable = Array.isArray(question.acceptableAnswers)
            ? question.acceptableAnswers.map((a) => String(a).trim()).filter(Boolean)
            : [];
          if (acceptable.length === 0 && canonical) acceptable = [canonical];
          setForm({
            questionType: qType,
            title: question.title || question.stem || "",
            stem: question.stem || question.title || "",
            correctAnswer: canonical,
            acceptableAnswers: acceptable.join("\n"),
          });
        } else if (qType === QUESTION_TYPES.CALCULATION) {
          const rawTol = parseFloat(question.calculationAnswerTolerancePercent);
          const dec =
            question.calculationAnswerDecimals !== undefined &&
            question.calculationAnswerDecimals !== null
              ? parseInt(question.calculationAnswerDecimals, 10)
              : 2;
          setForm({
            questionType: qType,
            title: question.title || "",
            stem: question.stem || "",
            calculationFormula: (question.calculationFormula || "").trim(),
            calculationVariables: JSON.stringify(
              Array.isArray(question.calculationVariables)
                ? question.calculationVariables
                : [],
              null,
              2
            ),
            calculationAnswerDecimals: Number.isFinite(dec) ? String(dec) : "2",
            calculationAnswerTolerancePercent: Number.isFinite(rawTol)
              ? String(Math.max(0, Math.min(100, rawTol)))
              : "",
          });
        } else if (qType === QUESTION_TYPES.OPEN_ENDED) {
          setForm({
            questionType: qType,
            title: question.title || "",
            stem: question.stem || question.title || "",
            openEndedSampleAnswer: String(question.openEndedSampleAnswer || "").trim(),
            openEndedGradingCriteria: String(
              question.openEndedGradingCriteria || ""
            ).trim(),
          });
        } else {
          const optionKeys = ["A", "B", "C", "D"];
          const options = optionKeys.map((key) => {
            const opt = question.options?.[key];
            if (typeof opt === "string") return { id: key, text: opt, feedback: "" };
            if (opt && typeof opt === "object") {
              return {
                id: opt.id || key,
                text: opt.text || String(opt),
                feedback: String(opt.feedback || ""),
              };
            }
            return { id: key, text: String(opt || ""), feedback: "" };
          });
          let correct = question.correctAnswer;
          if (typeof correct === "number") {
            correct = optionKeys[correct] || "A";
          } else if (typeof correct === "string") {
            correct = correct.toUpperCase();
          } else {
            correct = "A";
          }
          setForm({
            questionType: QUESTION_TYPES.MULTIPLE_CHOICE,
            title: question.title || question.stem || "",
            stem: question.stem || question.title || "",
            options,
            correctAnswer: correct,
            originalOptions: question.options || {},
          });
        }
      })
      .catch((error) => {
        if (!cancelled) setLoadError(error.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [questionId]);

  const set = (field) => (event) =>
    setForm((prev) => ({ ...prev, [field]: event.target.value }));

  const handleSave = async () => {
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
      if (!Array.isArray(variables) || variables.length === 0) {
        return showToast("Add at least one variable in the JSON array", "error");
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
      let tolPct = parseFloat(form.calculationAnswerTolerancePercent);
      tolPct = Number.isFinite(tolPct) ? Math.max(0, Math.min(100, tolPct)) : null;

      updateData = {
        title,
        stem,
        questionType: QUESTION_TYPES.CALCULATION,
        calculationFormula: formula,
        calculationVariables: variables,
        calculationAnswerDecimals: dec,
        calculationAnswerTolerancePercent: tolPct,
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
      if (form.options.some((opt) => !opt.text.trim())) {
        return showToast("All options must have text", "error");
      }
      const optionsObject = {};
      form.options.forEach((opt) => {
        const oldOption = form.originalOptions[opt.id];
        if (typeof oldOption === "object" && oldOption !== null) {
          optionsObject[opt.id] = {
            ...oldOption,
            text: opt.text.trim(),
            feedback: opt.feedback.trim(),
          };
        } else {
          optionsObject[opt.id] = { text: opt.text.trim(), feedback: opt.feedback.trim() };
        }
      });
      updateData = {
        title: title || stem,
        stem: stem || title,
        questionType: QUESTION_TYPES.MULTIPLE_CHOICE,
        options: optionsObject,
        correctAnswer: (form.correctAnswer || "A").toUpperCase(),
      };
    }

    setSaving(true);
    try {
      await api.put(`/api/question/${questionId}`, updateData);
      showToast("Question updated successfully", "success");
      onSaved?.();
      onClose();
    } catch (error) {
      console.error("Error saving question:", error);
      showToast(error.message || "Failed to save question", "error");
    } finally {
      setSaving(false);
    }
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
      {loading ? (
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
            <label className={labelClass}>
              {form.questionType === QUESTION_TYPES.MULTIPLE_CHOICE
                ? "Question Title"
                : "Topic title"}
            </label>
            <input
              type="text"
              value={form.title}
              onChange={set("title")}
              readOnly={readOnly}
              className={inputClass}
            />
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
                <label className={labelClass}>Variables (JSON array)</label>
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
              <div>
                <label className={labelClass}>
                  Answer tolerance %{" "}
                  <span className="font-normal text-muted">
                    (optional — leave blank for exact decimal rounding)
                  </span>
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.1}
                  value={form.calculationAnswerTolerancePercent}
                  onChange={set("calculationAnswerTolerancePercent")}
                  readOnly={readOnly}
                  placeholder="e.g. 2 for chemistry, 5 for engineering"
                  className={`${inputClass} max-w-44`}
                />
              </div>
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
              <div className="space-y-3">
                {form.options.map((option, index) => (
                  <div key={option.id} className="flex items-start gap-3">
                    <label className="flex items-center gap-2 pt-2">
                      <input
                        type="radio"
                        name="question-correct-answer"
                        checked={form.correctAnswer === option.id}
                        disabled={readOnly}
                        onChange={() =>
                          setForm((prev) => ({ ...prev, correctAnswer: option.id }))
                        }
                        className="h-4 w-4 accent-primary"
                      />
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-page text-sm font-bold text-ink">
                        {option.id}
                      </span>
                    </label>
                    <div className="flex-1 space-y-1.5">
                      <input
                        type="text"
                        value={option.text}
                        readOnly={readOnly}
                        placeholder="Enter option text..."
                        onChange={(event) =>
                          setForm((prev) => {
                            const options = [...prev.options];
                            options[index] = { ...options[index], text: event.target.value };
                            return { ...prev, options };
                          })
                        }
                        className={inputClass}
                      />
                      <input
                        type="text"
                        value={option.feedback}
                        readOnly={readOnly}
                        placeholder="Feedback for this option..."
                        onChange={(event) =>
                          setForm((prev) => {
                            const options = [...prev.options];
                            options[index] = {
                              ...options[index],
                              feedback: event.target.value,
                            };
                            return { ...prev, options };
                          })
                        }
                        className={`${inputClass} bg-gray-50 italic`}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
