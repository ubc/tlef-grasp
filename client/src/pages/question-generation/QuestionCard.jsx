import { useState } from "react";
import { QUESTION_TYPES } from "../../lib/constants";
import { escapeHtml } from "../../lib/format";
import RichText from "../../components/RichText";
import QuestionImage from "../../components/QuestionImage";
import QuestionImageField from "../../components/QuestionImageField";
import { useToast } from "../../components/ui/Toast";

const fieldLabel = "mb-1 block text-xs font-semibold text-muted";
const fieldInput =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none";

function FibBlock({ label, children }) {
  return (
    <div>
      <span className="text-xs font-semibold tracking-wide text-muted uppercase">
        {label}
      </span>
      <div className="mt-0.5 text-sm text-ink">{children}</div>
    </div>
  );
}

export default function QuestionCard({ question, onChange, onDelete, onSaveDraft }) {
  const showToast = useToast();
  const [isEditing, setIsEditing] = useState(false);
  // Local edit buffer so blur-commits don't fight React re-renders
  const [draft, setDraft] = useState(null);

  const qType = question.questionType || question.type || QUESTION_TYPES.MULTIPLE_CHOICE;
  const isFib = qType === QUESTION_TYPES.FILL_IN_THE_BLANK;
  const isCalc = qType === QUESTION_TYPES.CALCULATION;
  const isOpen = qType === QUESTION_TYPES.OPEN_ENDED;
  const isMcq = !isFib && !isCalc && !isOpen;

  // Coalesce the current array field with the legacy single-image field.
  const stemImages =
    question.stemImages || (question.stemImage ? [question.stemImage] : []);

  // Shared stem-image editor/display, reused across every question type.
  const stemImageEditor = (
    <div>
      <label className={fieldLabel}>Images (optional)</label>
      <QuestionImageField
        value={draft?.stemImages}
        onChange={(images) => setDraft((prev) => ({ ...prev, stemImages: images }))}
      />
    </div>
  );
  const stemImageDisplay =
    stemImages.length > 0 ? (
      <div className="flex flex-wrap gap-2">
        {stemImages.map((img) => (
          <QuestionImage key={img.fileId} image={img} />
        ))}
      </div>
    ) : null;

  // Duplicate-option detection for MCQs (legacy renderQuestionCard behavior)
  let reviewFlag = question.reviewFlag;
  let reviewIssue = question.reviewIssue;
  if (!reviewFlag && isMcq && question.options) {
    const texts = Object.values(question.options).map((o) =>
      (typeof o === "string" ? o : o.text || "").trim().toLowerCase()
    );
    if (texts.some((t, i) => texts.indexOf(t) !== i)) {
      reviewFlag = true;
      reviewIssue =
        "Two or more answer options are identical. Each option must present a distinct choice.";
    }
  }

  const startEdit = () => {
    setDraft({
      title: question.title || "",
      stem: question.stem || "",
      stemImages: question.stemImages || (question.stemImage ? [question.stemImage] : []),
      correctAnswer: question.correctAnswer ?? "",
      acceptableAnswers: Array.isArray(question.acceptableAnswers)
        ? question.acceptableAnswers.join("\n")
        : "",
      calculationFormula: question.calculationFormula || "",
      calculationVariablesJson: JSON.stringify(
        question.calculationVariables || [],
        null,
        2
      ),
      calculationAnswerDecimals: String(question.calculationAnswerDecimals ?? 2),
      openEndedSampleAnswer: question.openEndedSampleAnswer || "",
      openEndedGradingCriteria: question.openEndedGradingCriteria || "",
      options: question.options
        ? Object.fromEntries(
            Object.entries(question.options).map(([key, opt]) => [
              key,
              {
                text: opt.text || "",
                feedback: opt.feedback || "",
              },
            ])
          )
        : {},
    });
    setIsEditing(true);
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setDraft(null);
  };

  const setField = (field) => (event) =>
    setDraft((prev) => ({ ...prev, [field]: event.target.value }));

  const saveEdit = () => {
    const updates = {
      title: draft.title.trim(),
      stem: draft.stem.trim(),
    };

    if (isFib) {
      if (!updates.title) return showToast("Topic title is required", "error");
      if (!updates.stem) return showToast("Question stem is required", "error");
      if (!updates.stem.includes("_________")) {
        return showToast(
          "Stem must include exactly one blank written as _________ (nine underscores)",
          "error"
        );
      }
      const correct = draft.correctAnswer.trim();
      if (!correct) return showToast("Correct answer is required", "error");
      const lines = draft.acceptableAnswers
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      updates.correctAnswer = correct;
      updates.acceptableAnswers = lines.length === 0 ? [correct] : lines;
    } else if (isCalc) {
      if (!updates.title) return showToast("Topic title is required", "error");
      if (!updates.stem) return showToast("Question template is required", "error");
      const formula = draft.calculationFormula.trim();
      if (!formula) return showToast("Formula is required", "error");
      let vars;
      try {
        vars = JSON.parse(draft.calculationVariablesJson.trim() || "[]");
      } catch {
        vars = question.calculationVariables;
      }
      if (!Array.isArray(vars) || vars.length === 0) {
        return showToast("At least one variable is required (JSON array)", "error");
      }
      for (let i = 0; i < vars.length; i++) {
        const v = vars[i];
        if (!v || typeof v !== "object" || !String(v.name || "").trim()) {
          return showToast(`Variable ${i + 1}: each entry needs a name`, "error");
        }
        const min = Number(v.min);
        const max = Number(v.max);
        if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
          return showToast(`Variable "${v.name}": invalid min/max`, "error");
        }
      }
      let d = parseInt(draft.calculationAnswerDecimals, 10);
      if (!Number.isFinite(d)) d = 2;
      updates.calculationFormula = formula;
      updates.calculationVariables = vars;
      updates.calculationAnswerDecimals = Math.max(0, Math.min(12, d));
    } else if (isOpen) {
      if (!updates.title) return showToast("Topic title is required", "error");
      if (!updates.stem) return showToast("Question prompt is required", "error");
      const sample = draft.openEndedSampleAnswer.trim();
      const criteria = draft.openEndedGradingCriteria.trim();
      if (!sample) return showToast("Sample answer is required", "error");
      if (!criteria) return showToast("Grading criteria are required", "error");
      updates.openEndedSampleAnswer = sample;
      updates.openEndedGradingCriteria = criteria;
    } else {
      const optionKeys = Object.keys(draft.options);
      if (optionKeys.length > 0 && !optionKeys.includes(draft.correctAnswer)) {
        return showToast("Select which option is the correct answer", "error");
      }
      updates.options = Object.fromEntries(
        Object.entries(draft.options).map(([key, opt]) => [
          key,
          {
            id: key,
            text: opt.text.trim(),
            feedback: opt.feedback.trim(),
          },
        ])
      );
      updates.correctAnswer = draft.correctAnswer;
    }
    updates.stemImages = draft.stemImages || [];

    updates.lastEdited = new Date().toISOString().slice(0, 16).replace("T", " ");
    onChange(updates);
    setIsEditing(false);
    setDraft(null);
    showToast("Question updated successfully", "success");
    onSaveDraft();
  };

  const typeChipLabel = isFib
    ? "Fill-in-the-blank"
    : isCalc
      ? "Calculation"
      : isOpen
        ? "Open-ended"
        : null;

  const altAccepted = isFib
    ? (Array.isArray(question.acceptableAnswers) ? question.acceptableAnswers : [])
        .map((a) => String(a).trim())
        .filter(
          (a) =>
            a &&
            a.toLowerCase() !== String(question.correctAnswer ?? "").trim().toLowerCase()
        )
    : [];

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      {/* Header */}
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {isEditing ? (
            <input
              type="text"
              value={draft.title}
              onChange={setField("title")}
              placeholder={
                isMcq ? undefined : "Topic title (short; do not reveal the answer)"
              }
              className={`${fieldInput} mb-2 font-semibold`}
            />
          ) : (
            <RichText
              text={escapeHtml(question.title)}
              as="h5"
              className="mb-2 font-semibold text-ink"
            />
          )}
          <div className="flex flex-wrap gap-1.5">
            {typeChipLabel && (
              <span className="rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-medium text-purple-700">
                {typeChipLabel}
              </span>
            )}
            <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700">
              {question.metaCode}
            </span>
            <span className="rounded-full bg-teal-100 px-2.5 py-0.5 text-xs font-medium text-teal-700">
              {question.loCode}
            </span>
            <span className="rounded-full bg-yellow-100 px-2.5 py-0.5 text-xs font-medium text-yellow-700">
              Bloom: {question.bloom}
            </span>
          </div>
        </div>
        <div className="shrink-0 text-right text-xs text-muted">
          <span
            className={`mb-1 inline-block rounded-full px-2.5 py-0.5 font-semibold ${
              question.status === "Approved"
                ? "bg-green-100 text-green-700"
                : "bg-gray-100 text-gray-600"
            }`}
          >
            {question.status}
          </span>
          <div>Last Edited: {question.lastEdited}</div>
          <div>By: {question.by}</div>
        </div>
      </div>

      {/* Review warning */}
      {reviewFlag && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-warning/60 bg-warning/10 px-4 py-2.5 text-sm text-yellow-800">
          <i className="fas fa-exclamation-triangle mt-0.5" />
          <span>{reviewIssue}</span>
        </div>
      )}

      {/* Body */}
      {isFib &&
        (isEditing ? (
          <div className="space-y-3">
            <div>
              <label className={fieldLabel}>Question stem</label>
              <textarea
                rows={5}
                value={draft.stem}
                onChange={setField("stem")}
                placeholder="One declarative sentence with exactly _________ (nine underscores) for the blank"
                className={fieldInput}
              />
            </div>
            {stemImageEditor}
            <div>
              <label className={fieldLabel}>Correct answer</label>
              <input
                type="text"
                value={draft.correctAnswer}
                onChange={setField("correctAnswer")}
                placeholder="Canonical correct answer"
                className={fieldInput}
              />
            </div>
            <div>
              <label className={fieldLabel}>
                Acceptable answers{" "}
                <span className="font-normal">(optional, one per line)</span>
              </label>
              <textarea
                rows={3}
                value={draft.acceptableAnswers}
                onChange={setField("acceptableAnswers")}
                placeholder="Synonyms or alternate spellings, one per line"
                className={fieldInput}
              />
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <FibBlock label="Question stem">
              <RichText text={escapeHtml(question.stem || "")} />
            </FibBlock>
            {stemImageDisplay}
            <FibBlock label="Correct answer">
              <RichText text={escapeHtml(question.correctAnswer ?? "")} />
            </FibBlock>
            {altAccepted.length > 0 && (
              <FibBlock label="Also accepted">
                <RichText text={escapeHtml(altAccepted.join(", "))} />
              </FibBlock>
            )}
          </div>
        ))}

      {isCalc &&
        (isEditing ? (
          <div className="space-y-3">
            <div>
              <label className={fieldLabel}>Question template</label>
              <textarea
                rows={4}
                value={draft.stem}
                onChange={setField("stem")}
                placeholder="Use {{variableName}} placeholders matching the formula"
                className={fieldInput}
              />
            </div>
            {stemImageEditor}
            <div>
              <label className={fieldLabel}>Formula</label>
              <input
                type="text"
                value={draft.calculationFormula}
                onChange={setField("calculationFormula")}
                placeholder="e.g. V / R"
                className={fieldInput}
              />
            </div>
            <div>
              <label className={fieldLabel}>Variables (JSON array)</label>
              <textarea
                rows={6}
                value={draft.calculationVariablesJson}
                onChange={setField("calculationVariablesJson")}
                placeholder='[{"name":"x","min":1,"max":10,"integerOnly":true}]'
                className={`${fieldInput} font-mono`}
              />
            </div>
            <div>
              <label className={fieldLabel}>Answer decimal places (0–12)</label>
              <input
                type="number"
                min={0}
                max={12}
                step={1}
                value={draft.calculationAnswerDecimals}
                onChange={setField("calculationAnswerDecimals")}
                className={`${fieldInput} max-w-28`}
              />
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <FibBlock label="Template">
              <RichText text={escapeHtml(question.stem || "")} />
            </FibBlock>
            {stemImageDisplay}
            <FibBlock label="Formula">
              <RichText text={escapeHtml(question.calculationFormula || "")} />
            </FibBlock>
            <FibBlock label="Variables">
              {Array.isArray(question.calculationVariables) &&
              question.calculationVariables.length > 0 ? (
                <ul className="list-disc space-y-0.5 pl-5">
                  {question.calculationVariables.map((variable, index) => (
                    <li key={index}>
                      <strong>{String(variable?.name ?? "")}</strong>:{" "}
                      {String(variable?.min)}–{String(variable?.max)}
                      {variable?.integerOnly
                        ? " (integers)"
                        : ` (decimals: ${String(variable?.decimals ?? 0)})`}
                    </li>
                  ))}
                </ul>
              ) : (
                "—"
              )}
            </FibBlock>
            <FibBlock label="Answer decimal places">
              {String(question.calculationAnswerDecimals ?? 2)}
            </FibBlock>
          </div>
        ))}

      {isOpen &&
        (isEditing ? (
          <div className="space-y-3">
            <div>
              <label className={fieldLabel}>Question prompt</label>
              <textarea
                rows={5}
                value={draft.stem}
                onChange={setField("stem")}
                placeholder="Open-ended task for students"
                className={fieldInput}
              />
            </div>
            {stemImageEditor}
            <div>
              <label className={fieldLabel}>
                Sample answer <span className="font-normal">(shown after submit)</span>
              </label>
              <textarea
                rows={4}
                value={draft.openEndedSampleAnswer}
                onChange={setField("openEndedSampleAnswer")}
                placeholder="Model answer"
                className={fieldInput}
              />
            </div>
            <div>
              <label className={fieldLabel}>Grading criteria</label>
              <textarea
                rows={4}
                value={draft.openEndedGradingCriteria}
                onChange={setField("openEndedGradingCriteria")}
                placeholder="Rubric or bullet criteria"
                className={fieldInput}
              />
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <FibBlock label="Prompt">
              <RichText text={escapeHtml(question.stem || "")} />
            </FibBlock>
            {stemImageDisplay}
            <FibBlock label="Sample answer">
              <RichText text={escapeHtml(question.openEndedSampleAnswer || "")} />
            </FibBlock>
            <FibBlock label="Grading criteria">
              <RichText text={escapeHtml(question.openEndedGradingCriteria || "")} />
            </FibBlock>
          </div>
        ))}

      {isMcq && (
        <div>
          {isEditing ? (
            <div className="mb-3 space-y-2">
              <textarea
                rows={2}
                value={draft.stem}
                onChange={setField("stem")}
                className={fieldInput}
              />
              <QuestionImageField
                value={draft.stemImages}
                onChange={(images) =>
                  setDraft((prev) => ({ ...prev, stemImages: images }))
                }
              />
            </div>
          ) : (
            <div className="mb-3">
              <RichText
                text={escapeHtml(question.stem)}
                className="text-sm text-ink"
              />
              <div className="flex flex-wrap gap-2">
                {stemImages.map((img) => (
                  <QuestionImage key={img.fileId} image={img} />
                ))}
              </div>
            </div>
          )}
          <div className="space-y-2">
            {Object.values(question.options || {}).map((option) => {
              const isCorrect = isEditing
                ? option.id === draft.correctAnswer
                : option.id === question.correctAnswer;
              return (
                <div key={option.id}>
                  <div
                    className={`flex items-start gap-2.5 rounded-lg border p-2.5 ${
                      isCorrect ? "border-success bg-success/5" : "border-gray-200"
                    }`}
                  >
                    <input
                      type="radio"
                      name={`q-${question.id}`}
                      checked={isCorrect}
                      disabled={!isEditing}
                      readOnly={!isEditing}
                      onChange={
                        isEditing
                          ? () =>
                              setDraft((prev) => ({
                                ...prev,
                                correctAnswer: option.id,
                              }))
                          : undefined
                      }
                      aria-label={
                        isEditing
                          ? `Mark option ${option.id} as the correct answer`
                          : undefined
                      }
                      className={`mt-1 h-4 w-4 accent-success ${
                        isEditing ? "cursor-pointer" : ""
                      }`}
                    />
                    {isEditing ? (
                      <input
                        type="text"
                        value={draft.options[option.id]?.text || ""}
                        onChange={(event) =>
                          setDraft((prev) => ({
                            ...prev,
                            options: {
                              ...prev.options,
                              [option.id]: {
                                ...prev.options[option.id],
                                text: event.target.value,
                              },
                            },
                          }))
                        }
                        className={fieldInput}
                      />
                    ) : (
                      <RichText
                        text={`${option.id}. ${escapeHtml(option.text)}`}
                        className="min-w-0 flex-1 text-sm text-ink"
                      />
                    )}
                  </div>
                  {isEditing ? (
                    <div className="mt-1 ml-7 flex items-center gap-2">
                      <span className="text-xs text-muted">Feedback:</span>
                      <input
                        type="text"
                        value={draft.options[option.id]?.feedback || ""}
                        onChange={(event) =>
                          setDraft((prev) => ({
                            ...prev,
                            options: {
                              ...prev.options,
                              [option.id]: {
                                ...prev.options[option.id],
                                feedback: event.target.value,
                              },
                            },
                          }))
                        }
                        className={`${fieldInput} text-xs italic`}
                      />
                    </div>
                  ) : (
                    !isCorrect &&
                    option.feedback && (
                      <div className="mt-1 ml-7 text-xs text-muted">
                        <i className="fas fa-info-circle mr-1" />
                        {option.feedback}
                      </div>
                    )
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Flag reason */}
      {question.flagStatus && (
        <div className="mt-4">
          <label className="mb-1 flex items-center gap-1 text-xs font-medium text-red-600">
            <i className="fas fa-flag text-[10px]" /> Flag reason
            <span className="font-normal text-muted">(optional)</span>
          </label>
          <textarea
            value={question.flagReason || ""}
            onChange={(event) => onChange({ flagReason: event.target.value })}
            onBlur={onSaveDraft}
            rows={2}
            placeholder="Add a note explaining why this question is flagged…"
            className="w-full rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-red-400 focus:outline-none"
          />
        </div>
      )}

      {/* Footer */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              onChange({
                status: question.status === "Approved" ? "Draft" : "Approved",
              });
              onSaveDraft();
            }}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              question.status === "Approved"
                ? "bg-success text-white hover:bg-success/85"
                : "bg-gray-100 text-muted hover:bg-gray-200"
            }`}
          >
            {question.status === "Approved" ? "Approve on save" : "Draft on save"}
          </button>
          <span className="text-xs text-muted">
            Click to{" "}
            {question.status === "Approved"
              ? "revert to Draft"
              : "approve when saved to the bank"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={isEditing ? cancelEdit : startEdit}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-gray-50"
          >
            {isEditing ? "Cancel" : "Edit"}
          </button>
          <button
            type="button"
            onClick={() => {
              const nextFlag = !question.flagStatus;
              // Unflagging discards any reason so it doesn't resurface on re-flag.
              onChange(
                nextFlag
                  ? { flagStatus: true }
                  : { flagStatus: false, flagReason: "" }
              );
              showToast(
                `Question ${nextFlag ? "Flagged" : "Unflagged"}`,
                "success"
              );
              onSaveDraft();
            }}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              question.flagStatus
                ? "bg-red-50 text-red-600 hover:bg-red-100"
                : "border border-gray-300 text-ink hover:bg-gray-50"
            }`}
          >
            {question.flagStatus ? "Unflag" : "Flag"}
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="rounded-lg border border-danger/40 px-3 py-1.5 text-xs font-medium text-danger transition-colors hover:bg-danger/5"
          >
            Delete
          </button>
          {isEditing && (
            <button
              type="button"
              onClick={saveEdit}
              className="rounded-lg bg-primary px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary-dark"
            >
              Save
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
