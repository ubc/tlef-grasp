import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useSelectedCourse } from "../stores/appStore";
import { useCourseMaterials } from "../hooks/useMaterials";
import { useCourseQuizzes, useInvalidateQuizzes } from "../hooks/useQuizzes";
import { useMutation } from "@tanstack/react-query";
import { useInvalidateQuestions } from "../hooks/useQuestions";
import { api } from "../lib/api";
import { useToast } from "../components/ui/Toast";
import Modal from "../components/ui/Modal";
import ObjectivesStep from "./question-generation/ObjectivesStep";
import QuestionsStep from "./question-generation/QuestionsStep";
import SaveQuizStep from "./question-generation/SaveQuizStep";
import { useQuestionDraft } from "./question-generation/useQuestionDraft";
import {
  generateQuestions,
  convertQuestionsToGroups,
  buildQuestionPayload,
} from "./question-generation/generationApi";
import { attachSavedIds } from "./question-generation/savedQuestionIds";

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
  const [regeneratingObjectives, setRegeneratingObjectives] = useState(false);
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

  // Save the page's questions to the bank. Questions already there (they
  // have an _id) are updated with this page's edits rather than saved again;
  // one whose bank copy has since been deleted (404) is saved as new, like a
  // question that was never saved. New ids are recorded on the page straight
  // away, so a later failure cannot make a retry save them twice. Returns the
  // bank id of every page question, in page order (null where a save failed).
  const invalidateQuestions = useInvalidateQuestions(courseId);
  const invalidateQuizzes = useInvalidateQuizzes(courseId);
  const saveToBank = async (pageQuestions) => {
    const deleted = [];
    await Promise.all(
      pageQuestions
        .filter((q) => q._id)
        .map((q) =>
          api.put(`/api/question/${q._id}`, buildQuestionPayload(q)).catch((error) => {
            if (error.status !== 404) throw error;
            deleted.push(q);
          })
        )
    );
    const toSave = [...pageQuestions.filter((q) => !q._id), ...deleted];
    const data = toSave.length
      ? await api.post("/api/question/save", {
          courseId,
          questions: toSave.map(buildQuestionPayload),
        })
      : {};
    const localIds = toSave.map((q) => q.id);
    // Record the bank ids so Step 2 can offer to delete from the bank.
    setQuestionGroups((prev) => attachSavedIds(prev, localIds, data.questionIdsByIndex));
    invalidateQuestions();
    clearDraft();
    const newIds = new Map(localIds.map((id, i) => [id, data.questionIdsByIndex?.[i] || null]));
    return {
      ids: pageQuestions.map((q) => (newIds.has(q.id) ? newIds.get(q.id) : q._id)),
      // Updated questions plus the ones the save call actually stored.
      savedCount: pageQuestions.length - localIds.length + (data.savedCount || 0),
    };
  };

  const addToBankMutation = useMutation({
    mutationFn: saveToBank,
    onSuccess: ({ savedCount: count }) => {
      setSuccessMessage(
        `Successfully saved ${count} question${count !== 1 ? "s" : ""} to the Question Bank!`
      );
    },
    onError: (error) => {
      console.error("Error saving to bank:", error);
      showToast(error.message, "error");
    },
  });

  // Step 3 goes through the bank first, so a quiz only ever gets the bank's
  // own questions: never a second copy of one already saved.
  const saveToQuizMutation = useMutation({
    mutationFn: async ({ pageQuestions, quiz }) => {
      const questionIds = (await saveToBank(pageQuestions)).ids.filter(Boolean);
      if (quiz.quizId) {
        const data = await api.post(`/api/quiz/${quiz.quizId}/existing-questions`, {
          questionIds,
        });
        return data.insertedCount;
      }
      const data = await api.post("/api/quiz", { courseId, ...quiz, questionIds });
      return data.questionsAdded;
    },
    onSuccess: (count, { quiz }) => {
      invalidateQuizzes();
      const plural = count !== 1 ? "s" : "";
      if (quiz.quizId) {
        setSuccessMessage(`Successfully added ${count} question${plural} to quiz!`);
        setQuizForm((prev) => ({ ...prev, selectedQuizId: "" }));
      } else {
        setSuccessMessage(`Successfully created quiz and added ${count} question${plural}!`);
        setQuizForm((prev) => ({ ...prev, quizName: "", quizDescription: "" }));
      }
    },
    onError: (error) => {
      console.error("Error adding questions to quiz:", error);
      showToast(error.message || "Failed to add questions to quiz", "error");
    },
  });

  const saving = saveToQuizMutation.isPending;
  const addingToBank = addToBankMutation.isPending;

  /* ------------------------------ Generation ------------------------------ */

  const runGeneration = async () => {
    setGenerating(true);
    setGenerationError(null);
    const totalExpected = objectiveGroups.reduce(
      (sum, g) => sum + g.items.reduce((s, item) => s + (item.count || 1), 0),
      0
    );
    setGenerationMessage(
      `Generating questions — 0 of ${totalExpected} (includes automatic quality review and fixes)`
    );

    try {
      const { questions, failures } = await generateQuestions(
        selectedCourse,
        objectiveGroups,
        ({ generated, total }) =>
          setGenerationMessage(
            `Generating questions — ${generated} of ${total} (includes automatic quality review and fixes)`
          )
      );

      if (failures?.length > 0) {
        const rateLimited = failures.filter((failure) => failure.rateLimited).length;
        // Name the failed objectives so the instructor knows what to
        // regenerate, but cap the list so a large failure set doesn't
        // produce an unreadable toast.
        const names = failures.map((failure) => failure.objectiveText).filter(Boolean);
        const shown = names.slice(0, 3);
        const extra = names.length - shown.length;
        const nameList = extra > 0 ? `${shown.join(", ")}, and ${extra} more` : shown.join(", ");
        showToast(
          `${failures.length} objective${failures.length === 1 ? "" : "s"} could not be generated` +
            (nameList ? `: ${nameList}` : "") +
            (rateLimited > 0 ? " (the AI provider was rate limiting)" : "") +
            ". The rest are ready below.",
          "warning"
        );
      }

      const groups = convertQuestionsToGroups(questions);

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
        // A Bloom level exists on an item only while it has a question type
        // with a count, so "has levels" and "has something to generate" are the
        // same condition — an item whose types were all zeroed arrives here with
        // no levels and is caught by this one check.
        if (item.mode !== "manual") return;
        if (item.bloom.length === 0) hasBloomError = true;
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
    questionGroups.flatMap((group) => group.los.flatMap((lo) => lo.questions));

  const handleSaveToQuiz = () => {
    const pageQuestions = collectQuestions();
    if (pageQuestions.length === 0) {
      showToast("No questions to save", "error");
      return;
    }

    if (quizTab === "create") {
      if (!quizForm.quizName.trim()) {
        showToast("Please enter a quiz name", "error");
        return;
      }
      saveToQuizMutation.mutate({
        pageQuestions,
        quiz: {
          name: quizForm.quizName.trim(),
          description: quizForm.quizDescription.trim() || "",
          deliveryFormat: quizForm.deliveryFormat || "all-approved",
        },
      });
    } else {
      if (!quizForm.selectedQuizId) {
        showToast("Please select or create a quiz", "error");
        return;
      }
      saveToQuizMutation.mutate({ pageQuestions, quiz: { quizId: quizForm.selectedQuizId } });
    }
  };

  const handleAddAllToBank = () => {
    const pageQuestions = collectQuestions();
    if (pageQuestions.length === 0) {
      showToast("No questions to add", "warning");
      return;
    }
    addToBankMutation.mutate(pageQuestions);
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
          regenerating={regeneratingObjectives}
          setRegenerating={setRegeneratingObjectives}
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
          courseId={courseId}
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
      {/* Step 1 now ends with its own total line, so the footer tightens up
          underneath it: the usual mt-8 leaves that total stranded between the
          cards and the buttons instead of reading as the end of the list.
          Steps 2 and 3 end with a card and keep the full gap. */}
      <div
        className={`${step === 1 ? "mt-2" : "mt-8"} flex items-center justify-end gap-3`}
      >
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
            regeneratingObjectives ||
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
