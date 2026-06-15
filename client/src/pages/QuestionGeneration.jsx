import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useSelectedCourse } from "../stores/appStore";
import { useCourseMaterials } from "../hooks/useMaterials";
import { useCourseQuizzes, useCreateQuiz } from "../hooks/useQuizzes";
import { useSaveQuestions } from "../hooks/useQuestions";
import { useToast } from "../components/ui/Toast";
import Modal from "../components/ui/Modal";
import ObjectivesStep from "./question-generation/ObjectivesStep";
import QuestionsStep from "./question-generation/QuestionsStep";
import SaveQuizStep from "./question-generation/SaveQuizStep";
import { useQuestionDraft } from "./question-generation/useQuestionDraft";
import {
  generateQuestions,
  convertQuestionsToGroups,
  reviewGeneratedQuestions,
  buildQuestionPayload,
} from "./question-generation/generationApi";

const STEP_TITLES = {
  1: "Create Objectives",
  2: "Generate Questions",
  3: "Save Quiz to Question Bank",
};

const STEPS = [
  { number: 1, label: "Create Objectives" },
  { number: 2, label: "Generate Questions" },
  { number: 3, label: "Save Quiz to Question Bank" },
];

const EMPTY_QUIZ_FORM = {
  selectedQuizId: "",
  quizName: "",
  quizDescription: "",
  releaseDate: "",
  expireDate: "",
  deliveryFormat: "all-approved",
};

function Stepper({ step }) {
  return (
    <div className="mb-8 flex items-center justify-center gap-6">
      {STEPS.map(({ number, label }, index) => (
        <div key={number} className="flex items-center gap-6">
          {index > 0 && <div className="h-px w-12 bg-gray-300 max-md:hidden" />}
          <div className="flex items-center gap-2.5">
            <div
              className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold ${
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

function NoMaterialsState({ noCourse, onRefresh }) {
  return (
    <div className="mx-auto max-w-2xl px-5 py-16 text-center">
      <i className="fas fa-book-open mb-6 text-6xl text-primary" />
      <h2 className="mb-4 text-2xl font-semibold text-ink">
        {noCourse ? "No Course Selected" : "No Course Materials Found"}
      </h2>
      <p className="mb-8 text-muted">
        {noCourse
          ? "Please select a course first to generate questions."
          : "To generate questions, you'll need to upload course materials first. Please go to the Course Materials page to upload your files, text content, or URLs."}
      </p>
      <div className="flex flex-wrap justify-center gap-4">
        <Link
          to="/course-materials"
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 font-medium text-white transition-colors hover:bg-primary-dark"
        >
          <i className="fas fa-upload" /> Go to Course Materials
        </Link>
        <button
          type="button"
          onClick={onRefresh}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-5 py-2.5 font-medium text-ink transition-colors hover:bg-gray-50"
        >
          <i className="fas fa-sync" /> Refresh
        </button>
      </div>
      <div className="mt-10 rounded-lg bg-page p-5 text-left text-sm text-muted">
        <strong className="text-ink">Note:</strong> Once you've uploaded materials on
        the Course Materials page, you can return here to generate questions. The
        system will use the materials you've uploaded for the selected course.
      </div>
    </div>
  );
}

export default function QuestionGeneration() {
  const navigate = useNavigate();
  const showToast = useToast();
  const selectedCourse = useSelectedCourse();
  const courseId = selectedCourse?.id;

  const [step, setStep] = useState(1);
  const [objectiveGroups, setObjectiveGroups] = useState([]);
  const [questionGroups, setQuestionGroups] = useState([]);
  const [showValidation, setShowValidation] = useState(false);

  // Generation state
  const [generating, setGenerating] = useState(false);
  const [generationMessage, setGenerationMessage] = useState("");
  const [generationError, setGenerationError] = useState(null);

  // Step 3 state
  const [quizTab, setQuizTab] = useState("create");
  const [quizForm, setQuizForm] = useState(EMPTY_QUIZ_FORM);
  const [successMessage, setSuccessMessage] = useState(null);

  const questionGroupsRef = useRef(questionGroups);
  questionGroupsRef.current = questionGroups;

  const { draftPrompt, dismissDraftPrompt, saveDraft, clearDraft } =
    useQuestionDraft(courseId);
  const persistDraft = () => saveDraft(questionGroupsRef.current);

  const materialsQuery = useCourseMaterials(courseId);
  const hasMaterials =
    materialsQuery.data?.success && materialsQuery.materials.length > 0;

  const { quizzes, isPending: quizzesPending, isSuccess: quizzesLoaded } =
    useCourseQuizzes(courseId, { enabled: step === 3 });

  /* ------------------------------ Mutations ------------------------------ */

  const createQuizMutation = useCreateQuiz(courseId, {
    onSuccess: (data, variables) => {
      const count = data.questionsAdded || variables.newQuestions.length;
      clearDraft();
      setSuccessMessage(
        `Successfully created quiz and added ${count} question${count !== 1 ? "s" : ""}!`
      );
      setQuizForm((prev) => ({ ...prev, quizName: "", quizDescription: "" }));
    },
    onError: (error) => {
      console.error("Error adding questions to quiz:", error);
      showToast(error.message || "Failed to add questions to quiz", "error");
    },
  });

  const addToQuizMutation = useSaveQuestions(courseId, {
    onSuccess: (data, variables) => {
      const count = data.questionsAdded || variables.questions.length;
      clearDraft();
      setSuccessMessage(
        `Successfully added ${count} question${count !== 1 ? "s" : ""} to quiz!`
      );
      setQuizForm((prev) => ({ ...prev, selectedQuizId: "" }));
    },
    onError: (error) => {
      console.error("Error adding questions to quiz:", error);
      showToast(error.message || "Failed to add questions to quiz", "error");
    },
  });

  const addToBankMutation = useSaveQuestions(courseId, {
    onSuccess: (data, variables) => {
      const count = data.savedCount || variables.questions.length;
      clearDraft();
      setSuccessMessage(
        `Successfully added ${count} question${count !== 1 ? "s" : ""} to the Question Bank!`
      );
    },
    onError: (error) => {
      console.error("Error saving to bank:", error);
      showToast(error.message, "error");
    },
  });

  const saving = createQuizMutation.isPending || addToQuizMutation.isPending;
  const addingToBank = addToBankMutation.isPending;

  /* ------------------------------ Generation ------------------------------ */

  const runGeneration = async () => {
    setGenerating(true);
    setGenerationError(null);
    const totalExpected = objectiveGroups.reduce(
      (sum, g) => sum + g.items.reduce((s, item) => s + (item.count || 1), 0),
      0
    );
    setGenerationMessage(`Generating questions — 0 of ${totalExpected}`);

    try {
      const { questions } = await generateQuestions(
        selectedCourse,
        objectiveGroups,
        ({ generated, total }) =>
          setGenerationMessage(`Generating questions — ${generated} of ${total}`)
      );

      const groups = convertQuestionsToGroups(questions);
      setGenerationMessage(
        `Reviewing ${questions.length} questions for quality — almost done…`
      );
      await reviewGeneratedQuestions(groups, courseId);

      setQuestionGroups(groups);
      questionGroupsRef.current = groups;
      persistDraft();
    } catch (error) {
      console.error("Failed to generate questions from content:", error);
      setGenerationError(error.message);
      setQuestionGroups([]);
    } finally {
      setGenerating(false);
    }
  };

  /* ------------------------------ Navigation ------------------------------ */

  const validateStep1 = () => {
    if (objectiveGroups.length === 0) {
      showToast("Please add at least one learning objective", "error");
      return false;
    }
    let firstError = null;
    let hasBloomError = false;

    objectiveGroups.forEach((group) => {
      if (group.items.length === 0) {
        firstError ??= `Learning objective "${group.title}" has no granular objectives`;
        return;
      }
      group.items.forEach((item) => {
        if (item.mode === "manual" && item.bloom.length === 0) {
          hasBloomError = true;
        }
      });
    });

    if (firstError || hasBloomError) {
      if (firstError) showToast(firstError, "error");
      setShowValidation(true);
      return false;
    }
    setShowValidation(false);
    return true;
  };

  const goToNextStep = () => {
    if (step === 3) {
      handleSaveToQuiz();
      return;
    }
    if (step === 1) {
      if (!validateStep1()) return;
      setStep(2);
      setQuestionGroups([]);
      runGeneration();
    } else if (step === 2) {
      const hasQuestions =
        questionGroups.length > 0 &&
        questionGroups.some((group) => group.los.some((lo) => lo.questions.length > 0));
      if (!hasQuestions) return;
      setStep(3);
      setQuizTab("create");
      setQuizForm((prev) => ({ ...prev, selectedQuizId: "" }));
    }
  };

  /* ------------------------------ Step 3 save ------------------------------ */

  const collectQuestions = () =>
    questionGroups.flatMap((group) =>
      group.los.flatMap((lo) => lo.questions.map(buildQuestionPayload))
    );

  const handleSaveToQuiz = () => {
    const questions = collectQuestions();
    if (questions.length === 0) {
      showToast("No questions to save", "error");
      return;
    }

    if (quizTab === "create") {
      if (!quizForm.quizName.trim()) {
        showToast("Please enter a quiz name", "error");
        return;
      }
      if (!quizForm.releaseDate) {
        showToast("Please select a release date", "error");
        return;
      }
      if (!quizForm.expireDate) {
        showToast("Please select an expire date", "error");
        return;
      }
      createQuizMutation.mutate({
        courseId,
        name: quizForm.quizName.trim(),
        description: quizForm.quizDescription.trim() || "",
        releaseDate: new Date(quizForm.releaseDate).toISOString(),
        expireDate: new Date(quizForm.expireDate).toISOString(),
        deliveryFormat: quizForm.deliveryFormat || "all-approved",
        newQuestions: questions,
      });
    } else {
      if (!quizForm.selectedQuizId) {
        showToast("Please select or create a quiz", "error");
        return;
      }
      addToQuizMutation.mutate({ questions, quizId: quizForm.selectedQuizId });
    }
  };

  const handleAddAllToBank = () => {
    const questions = questionGroups.flatMap((group) =>
      group.los.flatMap((lo) =>
        lo.questions.map((question) => ({
          title: question.title || question.stem || "",
          stem: question.stem || question.title || "",
          options: question.options || [],
          correctAnswer: question.correctAnswer || 0,
          bloom: question.bloom || question.bloomLevel || "Understand",
          granularObjectiveId: question.granularObjectiveId || null,
          by: question.createdBy || "system",
          status: question.status || "Draft",
          flagStatus: question.flagStatus || false,
        }))
      )
    );

    if (questions.length === 0) {
      showToast("No questions to add", "warning");
      return;
    }
    addToBankMutation.mutate({ questions });
  };

  /* --------------------------------- Render -------------------------------- */

  if (!courseId || (materialsQuery.isSuccess && !hasMaterials)) {
    return (
      <NoMaterialsState
        noCourse={!courseId}
        onRefresh={() => materialsQuery.refetch()}
      />
    );
  }

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8">
      <Stepper step={step} />
      <h1 className="mb-6 text-2xl font-bold text-ink">{STEP_TITLES[step]}</h1>

      {step === 1 && (
        <ObjectivesStep
          course={selectedCourse}
          objectiveGroups={objectiveGroups}
          setObjectiveGroups={setObjectiveGroups}
          showValidation={showValidation}
        />
      )}

      {step === 2 && (
        <QuestionsStep
          questionGroups={questionGroups}
          setQuestionGroups={setQuestionGroups}
          generating={generating}
          generationMessage={generationMessage}
          generationError={generationError}
          onRegenerateAll={() => {
            setQuestionGroups([]);
            runGeneration();
          }}
          onRetry={runGeneration}
          onSaveDraft={persistDraft}
        />
      )}

      {step === 3 && (
        <SaveQuizStep
          quizzes={quizzes}
          quizzesPending={quizzesPending}
          quizzesLoaded={quizzesLoaded}
          tab={quizTab}
          onTabChange={(tab) => {
            setQuizTab(tab);
            if (tab === "create") {
              setQuizForm((prev) => ({ ...prev, selectedQuizId: "" }));
            }
          }}
          form={quizForm}
          onFormChange={setQuizForm}
        />
      )}

      {/* Footer actions */}
      <div className="mt-8 flex items-center justify-end gap-3">
        <button
          type="button"
          disabled={step === 1 || generating}
          onClick={() => setStep(step - 1)}
          className="rounded-lg border border-gray-300 bg-white px-5 py-2.5 font-medium text-ink transition-colors hover:bg-gray-50 disabled:opacity-40"
        >
          Back
        </button>
        {step === 2 && (
          <button
            type="button"
            disabled={generating || addingToBank}
            onClick={handleAddAllToBank}
            className="rounded-lg bg-primary px-5 py-2.5 font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-40"
          >
            {addingToBank ? "Saving..." : "Add to Question Bank"}
          </button>
        )}
        <button
          type="button"
          disabled={
            generating ||
            saving ||
            (step === 1 && objectiveGroups.length === 0) ||
            (step === 2 &&
              !questionGroups.some((g) => g.los.some((lo) => lo.questions.length > 0)))
          }
          onClick={goToNextStep}
          className="rounded-lg bg-primary px-5 py-2.5 font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-40"
        >
          {saving
            ? "Saving..."
            : step === 3
              ? "Save to Quiz"
              : step === 2
                ? "Add to Quiz"
                : "Continue"}
        </button>
      </div>

      {/* Draft restore modal */}
      <Modal
        open={!!draftPrompt}
        onClose={() => {}}
        title="Unsaved Questions Found"
        footer={
          <>
            <button
              type="button"
              onClick={() => {
                clearDraft();
                dismissDraftPrompt();
              }}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-gray-50"
            >
              Discard
            </button>
            <button
              type="button"
              onClick={() => {
                setQuestionGroups(draftPrompt.draft.questionGroups);
                setStep(2);
                dismissDraftPrompt();
              }}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-dark"
            >
              Continue Editing
            </button>
          </>
        }
      >
        <div className="py-3 text-center">
          <i className="fas fa-history mb-4 text-5xl text-warning" />
          <p className="mb-2 text-ink">
            You have {draftPrompt?.totalQuestions} question
            {draftPrompt?.totalQuestions !== 1 ? "s" : ""} from {draftPrompt?.savedAt}{" "}
            that were not saved to the question bank.
          </p>
          <p className="text-sm text-muted">
            These questions have not been saved to the question bank yet.
          </p>
        </div>
      </Modal>

      {/* Success modal */}
      <Modal
        open={!!successMessage}
        onClose={() => setSuccessMessage(null)}
        title="Questions Saved Successfully!"
      >
        <div className="py-3 text-center">
          <i className="fas fa-check-circle mb-5 text-6xl text-success" />
          <p className="mb-7 text-ink">{successMessage}</p>
          <button
            type="button"
            onClick={() => navigate("/question-bank")}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3 font-medium text-white transition-colors hover:bg-primary-dark"
          >
            <i className="fas fa-database" /> Go to Question Bank
          </button>
        </div>
      </Modal>
    </div>
  );
}
