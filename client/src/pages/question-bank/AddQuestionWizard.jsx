import { useState } from "react";
import { QUESTION_TYPES, BLOOM_LEVELS } from "../../lib/constants";
import { getObjectId } from "../../lib/utils";
import { useDetailedObjectives } from "../../hooks/useObjectives";
import { useSaveQuestions } from "../../hooks/useQuestions";
import Modal from "../../components/ui/Modal";
import QuestionDetailsFields from "./QuestionDetailsFields";
import { useToast } from "../../components/ui/Toast";

const inputClass =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none";
const labelClass = "mb-1 block text-sm font-semibold text-ink";
const hintClass = "mt-1 text-xs text-muted";

const STEP_LABELS = { 1: "Type", 2: "Details", 3: "Objective", 4: "Finish" };
const STEP_TITLES = {
  1: "Select Question Type",
  2: "Fill in Question Details",
  3: "Associate Learning Objective",
  4: "Review & Save",
};

const QUESTION_TYPE_CARDS = [
  { type: QUESTION_TYPES.MULTIPLE_CHOICE, icon: "fa-list-ul", name: "Multiple Choice", desc: "4 options, one correct answer" },
  { type: QUESTION_TYPES.FILL_IN_THE_BLANK, icon: "fa-pencil-alt", name: "Fill-in-the-Blank", desc: "Sentence with a blank to complete" },
  { type: QUESTION_TYPES.CALCULATION, icon: "fa-calculator", name: "Calculation", desc: "Formula with randomised variables" },
  { type: QUESTION_TYPES.OPEN_ENDED, icon: "fa-paragraph", name: "Open-Ended", desc: "Free-text with sample answer & rubric" },
];

const DEFAULT_OPTIONS = [
  { id: "A", text: "", feedback: "" },
  { id: "B", text: "", feedback: "" },
  { id: "C", text: "", feedback: "" },
  { id: "D", text: "", feedback: "" },
];

const DEFAULT_VAR = { name: "", min: "1", max: "10", type: "integer" };

export default function AddQuestionWizard({ courseId, quizzes, onClose }) {
  const showToast = useToast();
  const { objectives: detailedObjectives, isPending: objectivesLoading } =
    useDetailedObjectives(courseId);

  const [step, setStep] = useState(1);
  const [questionType, setQuestionType] = useState(null);
  const [form, setForm] = useState({
    title: "",
    stem: "",
    stemImages: [],
    options: DEFAULT_OPTIONS,
    correctAnswer: "A",
    fibCorrect: "",
    fibAcceptable: "",
    calcFormula: "",
    calcVars: [DEFAULT_VAR],
    calcDecimals: "2",
    calcTolerance: "",
    openSample: "",
    openCriteria: "",
  });
  const [metaObjectiveId, setMetaObjectiveId] = useState("");
  const [granularObjectiveId, setGranularObjectiveId] = useState("");
  const [bloom, setBloom] = useState("");
  const [approve, setApprove] = useState(false);
  const [quizId, setQuizId] = useState("");

  const selectedObjective = detailedObjectives.find((o) => o.id === metaObjectiveId);

  const validateStep = () => {
    if (step === 1) {
      if (!questionType) {
        showToast("Please select a question type", "error");
        return false;
      }
      return true;
    }

    if (step === 2) {
      if (!form.title.trim()) {
        showToast("Question title is required", "error");
        return false;
      }
      if (!form.stem.trim()) {
        showToast("Question stem is required", "error");
        return false;
      }
      if (questionType === QUESTION_TYPES.MULTIPLE_CHOICE) {
        if (form.options.some((o) => !o.text.trim())) {
          showToast("All 4 option texts are required", "error");
          return false;
        }
        const texts = form.options.map((o) => o.text.trim().toLowerCase());
        if (new Set(texts).size !== texts.length) {
          showToast(
            "Options must be unique — no two options may be identical",
            "error"
          );
          return false;
        }
      } else if (questionType === QUESTION_TYPES.FILL_IN_THE_BLANK) {
        if (!form.stem.includes("_________")) {
          showToast(
            "Stem must include exactly one blank: _________ (nine underscores)",
            "error"
          );
          return false;
        }
        if (!form.fibCorrect.trim()) {
          showToast("Correct answer is required", "error");
          return false;
        }
      } else if (questionType === QUESTION_TYPES.CALCULATION) {
        if (!form.calcFormula.trim()) {
          showToast("Answer formula is required", "error");
          return false;
        }
        if (form.calcVars.length === 0) {
          showToast("At least one variable is required", "error");
          return false;
        }
        const reserved = new Set(["e", "E", "pi", "PI"]);
        for (const v of form.calcVars) {
          const name = v.name.trim();
          if (!name) {
            showToast("Each variable needs a single-letter name", "error");
            return false;
          }
          if (!/^[a-zA-Z]$/.test(name)) {
            showToast(`Variable name "${name}" must be a single letter (a–z)`, "error");
            return false;
          }
          if (reserved.has(name)) {
            showToast(`"${name}" is reserved — choose a different letter`, "error");
            return false;
          }
          if (!Number.isFinite(parseFloat(v.min)) || !Number.isFinite(parseFloat(v.max))) {
            showToast(`Variable "${name}": min and max must be numbers`, "error");
            return false;
          }
          if (parseFloat(v.min) >= parseFloat(v.max)) {
            showToast(`Variable "${name}": max must be greater than min`, "error");
            return false;
          }
        }
        const names = form.calcVars.map((v) => v.name.trim());
        const dup = names.find((n, i) => names.indexOf(n) !== i);
        if (dup) {
          showToast(`Variable name "${dup}" is used more than once`, "error");
          return false;
        }
      } else if (questionType === QUESTION_TYPES.OPEN_ENDED) {
        if (!form.openSample.trim()) {
          showToast("Sample answer is required", "error");
          return false;
        }
        if (!form.openCriteria.trim()) {
          showToast("Grading criteria are required", "error");
          return false;
        }
      }
      return true;
    }

    if (step === 3) {
      if (!metaObjectiveId) {
        showToast("Please select a meta learning objective", "error");
        return false;
      }
      if (!granularObjectiveId) {
        showToast("Please select a granular learning objective", "error");
        return false;
      }
      if (!bloom) {
        showToast("Please select a Bloom's taxonomy level", "error");
        return false;
      }
      return true;
    }

    return true;
  };

  const saveMutation = useSaveQuestions(courseId, {
    onSuccess: () => {
      showToast("Question added successfully", "success");
      onClose();
    },
    onError: (error) => {
      console.error("Error saving new question:", error);
      showToast(error.message || "Failed to save question", "error");
    },
  });
  const saving = saveMutation.isPending;

  const submit = () => {
    const payload = {
      title: form.title.trim(),
      stem: form.stem.trim(),
      stemImages: form.stemImages || [],
      questionType,
      bloom,
      learningObjectiveId: metaObjectiveId,
      granularObjectiveId,
      status: approve ? "Approved" : "Draft",
      options: {},
      correctAnswer: "",
      acceptableAnswers: [],
    };

    if (questionType === QUESTION_TYPES.MULTIPLE_CHOICE) {
      const optionsObj = {};
      form.options.forEach((o) => {
        optionsObj[o.id] = { text: o.text.trim(), feedback: o.feedback.trim() };
      });
      payload.options = optionsObj;
      payload.correctAnswer = form.correctAnswer;
    } else if (questionType === QUESTION_TYPES.FILL_IN_THE_BLANK) {
      const acceptable = form.fibAcceptable
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      payload.correctAnswer = form.fibCorrect.trim();
      payload.acceptableAnswers = acceptable.length
        ? acceptable
        : [form.fibCorrect.trim()];
    } else if (questionType === QUESTION_TYPES.CALCULATION) {
      payload.calculationFormula = form.calcFormula.trim();
      payload.calculationVariables = form.calcVars.map((v) => {
        const variable = {
          name: v.name.trim(),
          min: parseFloat(v.min),
          max: parseFloat(v.max),
        };
        if (v.type === "integer") {
          variable.integerOnly = true;
        } else {
          variable.decimals = Math.max(0, Math.min(8, parseInt(v.type, 10) || 0));
        }
        return variable;
      });
      const dec = parseInt(form.calcDecimals, 10);
      payload.calculationAnswerDecimals = Number.isFinite(dec)
        ? Math.max(0, Math.min(12, dec))
        : 2;
      const tol = parseFloat(form.calcTolerance);
      payload.calculationAnswerTolerancePercent = Number.isFinite(tol)
        ? Math.max(0, Math.min(100, tol))
        : null;
    } else if (questionType === QUESTION_TYPES.OPEN_ENDED) {
      payload.openEndedSampleAnswer = form.openSample.trim();
      payload.openEndedGradingCriteria = form.openCriteria.trim();
    }

    saveMutation.mutate({ questions: [payload], quizId: quizId || null });
  };

  const advance = () => {
    if (!validateStep()) return;
    if (step === 4) {
      submit();
    } else {
      setStep(step + 1);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={STEP_TITLES[step]}
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
          {step > 1 && (
            <button
              type="button"
              onClick={() => setStep(step - 1)}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-gray-50"
            >
              Back
            </button>
          )}
          <button
            type="button"
            disabled={saving}
            onClick={advance}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-60"
          >
            {saving ? "Saving..." : step === 4 ? "Save Question" : "Next"}
          </button>
        </>
      }
    >
      {/* Step indicator */}
      <div className="mb-6 flex items-center justify-center gap-2">
        {[1, 2, 3, 4].map((s, index) => (
          <div key={s} className="flex items-center gap-2">
            {index > 0 && <div className="h-px w-4 bg-gray-200 md:w-8" />}
            <div className="flex items-center gap-1.5">
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  s === step
                    ? "bg-primary text-white"
                    : s < step
                      ? "bg-success text-white"
                      : "bg-gray-200 text-muted"
                }`}
              >
                {s < step ? <i className="fas fa-check" /> : s}
              </span>
              <span
                className={`text-xs font-medium max-sm:hidden ${s === step ? "text-ink" : "text-muted"}`}
              >
                {STEP_LABELS[s]}
              </span>
            </div>
          </div>
        ))}
      </div>

      {step === 1 && (
        <div className="grid grid-cols-2 gap-3">
          {QUESTION_TYPE_CARDS.map((card) => (
            <button
              key={card.type}
              type="button"
              onClick={() => setQuestionType(card.type)}
              className={`flex flex-col items-center gap-1.5 rounded-xl border-2 p-5 text-center transition-colors ${
                questionType === card.type
                  ? "border-primary bg-primary/5"
                  : "border-gray-200 hover:border-primary/40"
              }`}
            >
              <i className={`fas ${card.icon} text-xl text-primary`} />
              <span className="font-semibold text-ink">{card.name}</span>
              <span className="text-xs text-muted">{card.desc}</span>
            </button>
          ))}
        </div>
      )}

      {step === 2 && (
        <QuestionDetailsFields
          questionType={questionType}
          form={form}
          setForm={setForm}
        />
      )}

      {step === 3 &&
        (objectivesLoading ? (
          <div className="py-10 text-center text-muted">
            <i className="fas fa-spinner fa-spin mb-2 text-2xl text-primary" />
            <p>Loading objectives...</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className={labelClass}>Meta Learning Objective</label>
              <select
                value={metaObjectiveId}
                onChange={(event) => {
                  setMetaObjectiveId(event.target.value);
                  setGranularObjectiveId("");
                }}
                className={inputClass}
              >
                <option value="">— Select a learning objective —</option>
                {detailedObjectives.map((objective) => (
                  <option key={objective.id} value={objective.id}>
                    {objective.name}
                  </option>
                ))}
              </select>
            </div>
            {metaObjectiveId && (
              <div>
                <label className={labelClass}>Granular Learning Objective</label>
                <select
                  value={granularObjectiveId}
                  onChange={(event) => setGranularObjectiveId(event.target.value)}
                  className={inputClass}
                >
                  {selectedObjective?.granular?.length ? (
                    <>
                      <option value="">— Select a granular objective —</option>
                      {selectedObjective.granular.map((granular) => {
                        const gId = getObjectId(granular);
                        return (
                          <option key={gId} value={gId}>
                            {granular.name || granular.text || ""}
                          </option>
                        );
                      })}
                    </>
                  ) : (
                    <option value="">No granular objectives found</option>
                  )}
                </select>
              </div>
            )}
            <div>
              <label className={labelClass}>Bloom's Taxonomy Level</label>
              <select
                value={bloom}
                onChange={(event) => setBloom(event.target.value)}
                className={inputClass}
              >
                <option value="">— Select a Bloom's level —</option>
                {BLOOM_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ))}

      {step === 4 && (
        <div className="space-y-6">
          <div>
            <label className="flex cursor-pointer items-center gap-2.5">
              <input
                type="checkbox"
                checked={approve}
                onChange={(event) => setApprove(event.target.checked)}
                className="h-4.5 w-4.5 accent-primary"
              />
              <span className="text-ink">
                Mark as <strong>Approved</strong>
              </span>
            </label>
            <p className="mt-1.5 ml-7 text-xs text-muted">
              Leave unchecked to save as Draft for review later.
            </p>
          </div>
          <div>
            <label className={labelClass}>
              Add to a quiz <span className="font-normal text-muted">(optional)</span>
            </label>
            <select
              value={quizId}
              onChange={(event) => setQuizId(event.target.value)}
              className={inputClass}
            >
              <option value="">Don't add to any quiz</option>
              {quizzes.map((quiz) => (
                <option key={getObjectId(quiz)} value={getObjectId(quiz)}>
                  {quiz.name || "Unnamed Quiz"}
                </option>
              ))}
            </select>
            <p className={hintClass}>
              The question is always saved to the Question Bank. Selecting a quiz links
              it there too.
            </p>
          </div>
        </div>
      )}
    </Modal>
  );
}
