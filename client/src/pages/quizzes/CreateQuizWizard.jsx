import { useState } from "react";
import { useCourseMaterials } from "../../hooks/useMaterials";
import { useCourseObjectives } from "../../hooks/useObjectives";
import { useQuestions } from "../../hooks/useQuestions";
import { useCreateQuiz } from "../../hooks/useQuizzes";
import { toStringId, getObjectId } from "../../lib/utils";
import { getMaterialTypeMeta } from "../../lib/materials";
import { useToast } from "../../components/ui/Toast";
import DeliveryFormatToggle from "../../components/DeliveryFormatToggle";

const WIZARD_STEPS = [
  { number: 1, label: "Select Materials" },
  { number: 2, label: "Select Objectives" },
  { number: 3, label: "Quiz Settings" },
];

const selectionItemClass =
  "flex cursor-pointer items-center gap-3 rounded-xl border border-gray-200 p-3 transition-colors hover:border-primary/40 has-checked:border-primary has-checked:bg-primary/5";

function toggleInList(list, value) {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function StepIndicator({ step }) {
  return (
    <div className="mb-8 flex items-center justify-center gap-2 md:gap-4">
      {WIZARD_STEPS.map(({ number, label }, index) => (
        <div key={number} className="flex items-center gap-2 md:gap-4">
          {index > 0 && <div className="h-px w-6 bg-gray-200 md:w-16" />}
          <div className="flex items-center gap-2">
            <div
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                number === step
                  ? "bg-primary text-white"
                  : number < step
                    ? "bg-success text-white"
                    : "bg-gray-200 text-muted"
              }`}
            >
              {number < step ? <i className="fas fa-check" /> : number}
            </div>
            <span
              className={`text-sm font-medium max-md:hidden ${
                number === step ? "text-ink" : "text-muted"
              }`}
            >
              {label}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function CreateQuizWizard({ courseId, onCreated }) {
  const showToast = useToast();
  const [step, setStep] = useState(1);
  const [selectedMaterials, setSelectedMaterials] = useState([]);
  const [selectedObjectives, setSelectedObjectives] = useState([]);
  const [quizName, setQuizName] = useState("");
  const [deliveryFormat, setDeliveryFormat] = useState("all-approved");

  const { materials, isPending: materialsPending } = useCourseMaterials(courseId);
  const { objectives, isPending: objectivesPending } = useCourseObjectives(courseId);
  const { questions: courseQuestions, isPending: questionsPending } = useQuestions(
    courseId,
    { enabled: step === 3 }
  );

  const relevantObjectives = objectives.filter(
    (obj) =>
      Array.isArray(obj.materialIds) &&
      obj.materialIds.some((id) => selectedMaterials.includes(id))
  );

  const selectedObjStrs = selectedObjectives.map(toStringId);
  const matchedQuestions = courseQuestions.filter((q) =>
    selectedObjStrs.includes(toStringId(q.learningObjectiveId))
  );

  const createMutation = useCreateQuiz(courseId, {
    onSuccess: () => {
      showToast("Quiz created successfully", "success");
      setQuizName("");
      setSelectedMaterials([]);
      setSelectedObjectives([]);
      setStep(1);
      onCreated();
    },
    onError: (error) => showToast(error.message || "Failed to create quiz", "error"),
  });

  const handleNextStep1 = () => {
    if (selectedMaterials.length === 0) {
      showToast("Please select at least one material", "error");
      return;
    }
    setStep(2);
  };

  const handleNextStep2 = () => {
    if (selectedObjectives.length === 0) {
      showToast("Please select at least one learning objective", "error");
      return;
    }
    setStep(3);
  };

  const handleCreate = () => {
    const name = quizName.trim();
    if (!name) {
      showToast("Please provide a quiz name", "error");
      return;
    }
    if (matchedQuestions.length === 0) {
      showToast("No questions matched the selected objectives", "error");
      return;
    }

    createMutation.mutate({
      name,
      courseId,
      deliveryFormat,
      questionIds: matchedQuestions.map(getObjectId),
    });
  };

  return (
    <div className="rounded-2xl bg-white p-8 shadow-sm">
      <StepIndicator step={step} />

      {step === 1 && (
        <div>
          <h3 className="text-lg font-semibold text-ink">Select Course Materials</h3>
          <p className="mb-4 text-sm text-muted">
            Choose the materials you want to test the students on.
          </p>
          <div className="max-h-96 space-y-2 overflow-y-auto">
            {materialsPending ? (
              <div className="py-6 text-center text-muted">
                <i className="fas fa-spinner fa-spin mr-2" /> Loading materials...
              </div>
            ) : materials.length === 0 ? (
              <div className="py-6 text-center text-muted">
                No course materials found. Upload materials first.
              </div>
            ) : (
              materials.map((material) => {
                const meta = getMaterialTypeMeta(material.fileType || "");
                const value = material.sourceId || material._id;
                return (
                  <label key={value} className={selectionItemClass}>
                    <input
                      type="checkbox"
                      checked={selectedMaterials.includes(value)}
                      onChange={() =>
                        setSelectedMaterials((prev) => toggleInList(prev, value))
                      }
                      className="h-4 w-4 accent-primary"
                    />
                    <div
                      className={`flex h-9 w-9 items-center justify-center rounded-lg ${meta.badgeClasses}`}
                    >
                      <i className={`fas ${meta.icon}`} />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate font-medium text-ink">
                        {material.documentTitle || "Untitled Material"}
                      </div>
                      <div className="text-xs text-muted">{meta.label}</div>
                    </div>
                  </label>
                );
              })
            )}
          </div>
          <div className="mt-6 flex justify-end">
            <button
              type="button"
              onClick={handleNextStep1}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 font-medium text-white transition-colors hover:bg-primary-dark"
            >
              Next: Select Objectives <i className="fas fa-arrow-right" />
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div>
          <h3 className="text-lg font-semibold text-ink">Select Learning Objectives</h3>
          <p className="mb-4 text-sm text-muted">
            Select the meta learning objectives to include. Questions tied to these and
            their granular objectives will be added.
          </p>
          <div className="max-h-96 space-y-2 overflow-y-auto">
            {objectivesPending ? (
              <div className="py-6 text-center text-muted">
                <i className="fas fa-spinner fa-spin mr-2" /> Loading objectives...
              </div>
            ) : relevantObjectives.length === 0 ? (
              <div className="py-6 text-center text-muted">
                No meta learning objectives found for selected materials.
              </div>
            ) : (
              relevantObjectives.map((objective) => (
                <label key={objective._id} className={selectionItemClass}>
                  <input
                    type="checkbox"
                    checked={selectedObjectives.includes(objective._id)}
                    onChange={() =>
                      setSelectedObjectives((prev) =>
                        toggleInList(prev, objective._id)
                      )
                    }
                    className="h-4 w-4 accent-primary"
                  />
                  <span className="font-medium text-ink">{objective.name}</span>
                </label>
              ))
            )}
          </div>
          <div className="mt-6 flex justify-between">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-5 py-2.5 font-medium text-ink transition-colors hover:bg-gray-50"
            >
              <i className="fas fa-arrow-left" /> Back
            </button>
            <button
              type="button"
              onClick={handleNextStep2}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 font-medium text-white transition-colors hover:bg-primary-dark"
            >
              Next: Quiz Settings <i className="fas fa-arrow-right" />
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div>
          <h3 className="mb-4 text-lg font-semibold text-ink">Quiz Settings</h3>

          <div className="space-y-4">
            <div>
              <label
                htmlFor="new-quiz-name"
                className="mb-1 block text-sm font-semibold text-ink"
              >
                Quiz Name
              </label>
              <input
                id="new-quiz-name"
                type="text"
                value={quizName}
                onChange={(event) => setQuizName(event.target.value)}
                placeholder="e.g. Midterm Review Quiz"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-primary focus:outline-none"
              />
            </div>

            <div className="rounded-lg bg-page px-4 py-3 text-sm text-muted">
              <i className="fas fa-circle-info mr-1.5 text-primary" />
              Availability is set per section after creation — open the quiz on the
              Manage Quizzes tab and use “Schedule per section”. Until a section is
              scheduled, the quiz is visible to no one.
            </div>

            <div>
              <label className="mb-1 block text-sm font-semibold text-ink">
                Delivery Format
              </label>
              <DeliveryFormatToggle value={deliveryFormat} onChange={setDeliveryFormat} />
            </div>

            <div className="rounded-xl bg-page p-5">
              <div className="flex items-center gap-4">
                <i className="fas fa-list-ol text-2xl text-primary" />
                <div>
                  <div className="text-sm text-muted">Matching Questions Found</div>
                  <div className="text-2xl font-bold text-ink">
                    {questionsPending ? (
                      <i className="fas fa-spinner fa-spin text-base" />
                    ) : (
                      matchedQuestions.length
                    )}
                  </div>
                </div>
              </div>
              <div className="my-4 space-y-1">
                {relevantObjectives
                  .filter((obj) => selectedObjStrs.includes(toStringId(obj._id)))
                  .map((obj) => {
                    const count = matchedQuestions.filter(
                      (q) => toStringId(q.learningObjectiveId) === toStringId(obj._id)
                    ).length;
                    return (
                      <div
                        key={obj._id}
                        className="flex justify-between border-b border-dashed border-gray-200 py-1.5 text-sm text-gray-600"
                      >
                        <span className="mr-4 truncate">{obj.name}</span>
                        <span className="whitespace-nowrap font-semibold text-ink">
                          {count} Qs
                        </span>
                      </div>
                    );
                  })}
              </div>
              <p className="text-xs text-muted">
                These questions will be associated with your new quiz.
              </p>
            </div>
          </div>

          <div className="mt-6 flex justify-between">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-5 py-2.5 font-medium text-ink transition-colors hover:bg-gray-50"
            >
              <i className="fas fa-arrow-left" /> Back
            </button>
            <button
              type="button"
              onClick={handleCreate}
              disabled={createMutation.isPending}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-60"
            >
              {createMutation.isPending ? (
                <>
                  <i className="fas fa-spinner fa-spin" /> Creating...
                </>
              ) : (
                <>
                  <i className="fas fa-check" /> Create Quiz
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
