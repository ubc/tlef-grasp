import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAppStore } from "../stores/appStore";
import { useToast } from "../components/ui/Toast";
import Modal from "../components/ui/Modal";
import DeliveryFormatToggle from "../components/DeliveryFormatToggle";
import ObjectivesStep from "./question-generation/ObjectivesStep";
import QuestionsStep from "./question-generation/QuestionsStep";
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

const DRAFT_KEY_PREFIX = "grasp-draft-questions";

export default function QuestionGeneration() {
  const navigate = useNavigate();
  const showToast = useToast();
  const selectedCourse = useAppStore((state) => state.selectedCourse);
  const courseId = selectedCourse?.id;
  const draftKey = courseId ? `${DRAFT_KEY_PREFIX}-${courseId}` : null;

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
  const [selectedQuizId, setSelectedQuizId] = useState("");
  const [quizName, setQuizName] = useState("");
  const [quizDescription, setQuizDescription] = useState("");
  const [releaseDate, setReleaseDate] = useState("");
  const [expireDate, setExpireDate] = useState("");
  const [deliveryFormat, setDeliveryFormat] = useState("all-approved");
  const [saving, setSaving] = useState(false);
  const [addingToBank, setAddingToBank] = useState(false);
  const [successMessage, setSuccessMessage] = useState(null);

  // Draft restore
  const [draftPrompt, setDraftPrompt] = useState(null);
  const draftCheckedRef = useRef(false);

  const questionGroupsRef = useRef(questionGroups);
  questionGroupsRef.current = questionGroups;

  const materialsQuery = useQuery({
    queryKey: ["materials", courseId],
    queryFn: () => api.get(`/api/material/course/${courseId}`),
    enabled: !!courseId,
  });
  const hasMaterials =
    materialsQuery.data?.success && (materialsQuery.data.materials || []).length > 0;

  const quizzesQuery = useQuery({
    queryKey: ["quizzes", "course", courseId],
    queryFn: () => api.get(`/api/quiz/course/${courseId}`),
    enabled: !!courseId && step === 3,
  });
  const quizzes = quizzesQuery.data?.quizzes || [];

  /* --------------------------- Draft persistence --------------------------- */

  const saveDraft = () => {
    if (!draftKey || questionGroupsRef.current.length === 0) return;
    try {
      localStorage.setItem(
        draftKey,
        JSON.stringify({
          questionGroups: questionGroupsRef.current,
          savedAt: new Date().toISOString(),
        })
      );
    } catch (error) {
      console.warn("Failed to save draft to localStorage:", error);
    }
  };

  const clearDraft = () => {
    if (draftKey) localStorage.removeItem(draftKey);
  };

  useEffect(() => {
    if (draftCheckedRef.current || !draftKey) return;
    draftCheckedRef.current = true;
    try {
      const raw = localStorage.getItem(draftKey);
      const draft = raw ? JSON.parse(raw) : null;
      if (draft && Array.isArray(draft.questionGroups) && draft.questionGroups.length > 0) {
        const totalQuestions = draft.questionGroups.reduce(
          (sum, g) => sum + g.los.reduce((s, lo) => s + lo.questions.length, 0),
          0
        );
        const savedAt = draft.savedAt
          ? new Date(draft.savedAt).toLocaleString()
          : "a previous session";
        setDraftPrompt({ draft, totalQuestions, savedAt });
      }
    } catch {
      // Corrupt draft — ignore
    }
  }, [draftKey]);

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
      saveDraft();
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
      const totalQuestions = group.items.reduce(
        (sum, item) => sum + (item.count || 0),
        0
      );
      if (totalQuestions < 5) {
        firstError ??= `Learning objective "${group.title}" must have at least 5 questions (currently has ${totalQuestions})`;
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
      setSelectedQuizId("");
    }
  };

  /* ------------------------------ Step 3 save ------------------------------ */

  const collectQuestions = () => {
    const questions = [];
    questionGroups.forEach((group) =>
      group.los.forEach((lo) =>
        lo.questions.forEach((question) => questions.push(buildQuestionPayload(question)))
      )
    );
    return questions;
  };

  const handleSaveToQuiz = async () => {
    const questions = collectQuestions();
    if (questions.length === 0) {
      showToast("No questions to save", "error");
      return;
    }

    setSaving(true);
    try {
      if (quizTab === "create") {
        if (!quizName.trim()) {
          showToast("Please enter a quiz name", "error");
          return;
        }
        if (!releaseDate) {
          showToast("Please select a release date", "error");
          return;
        }
        if (!expireDate) {
          showToast("Please select an expire date", "error");
          return;
        }

        const data = await api.post("/api/quiz", {
          courseId,
          name: quizName.trim(),
          description: quizDescription.trim() || "",
          releaseDate: new Date(releaseDate).toISOString(),
          expireDate: new Date(expireDate).toISOString(),
          deliveryFormat: deliveryFormat || "all-approved",
          newQuestions: questions,
        });

        const questionsCount = data.questionsAdded || questions.length;
        clearDraft();
        setSuccessMessage(
          `Successfully created quiz and added ${questionsCount} question${questionsCount !== 1 ? "s" : ""}!`
        );
        setQuizName("");
        setQuizDescription("");
      } else {
        if (!selectedQuizId) {
          showToast("Please select or create a quiz", "error");
          return;
        }
        const data = await api.post(`/api/quiz/${selectedQuizId}/questions`, {
          courseId,
          questions,
        });
        const questionsCount = data.questionsAdded || questions.length;
        clearDraft();
        setSuccessMessage(
          `Successfully added ${questionsCount} question${questionsCount !== 1 ? "s" : ""} to quiz!`
        );
        setSelectedQuizId("");
      }
    } catch (error) {
      console.error("Error adding questions to quiz:", error);
      showToast(error.message || "Failed to add questions to quiz", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleAddAllToBank = async () => {
    const questions = [];
    questionGroups.forEach((group) =>
      group.los.forEach((lo) =>
        lo.questions.forEach((question) =>
          questions.push({
            title: question.title || question.stem || "",
            stem: question.stem || question.title || "",
            options: question.options || [],
            correctAnswer: question.correctAnswer || 0,
            bloom: question.bloom || question.bloomLevel || "Understand",
            granularObjectiveId: question.granularObjectiveId || null,
            by: question.createdBy || "system",
            status: question.status || "Draft",
            flagStatus: question.flagStatus || false,
          })
        )
      )
    );

    if (questions.length === 0) {
      showToast("No questions to add", "warning");
      return;
    }

    setAddingToBank(true);
    try {
      const data = await api.post("/api/question/save", { courseId, questions });
      const questionsCount = data.savedCount || questions.length;
      clearDraft();
      setSuccessMessage(
        `Successfully added ${questionsCount} question${questionsCount !== 1 ? "s" : ""} to the Question Bank!`
      );
    } catch (error) {
      console.error("Error saving to bank:", error);
      showToast(error.message, "error");
    } finally {
      setAddingToBank(false);
    }
  };

  /* --------------------------------- Render -------------------------------- */

  // No course / no materials states
  if (!courseId || (materialsQuery.isSuccess && !hasMaterials)) {
    const noCourse = !courseId;
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
            onClick={() => materialsQuery.refetch()}
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

  return (
    <div className="mx-auto max-w-5xl p-8">
      {/* Stepper */}
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

      <h1 className="mb-6 text-2xl font-bold text-ink">{STEP_TITLES[step]}</h1>

      {/* Step content */}
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
          onSaveDraft={saveDraft}
        />
      )}

      {step === 3 && (
        <div className="rounded-2xl bg-white p-8 shadow-sm">
          <p className="mb-6 text-muted">
            Select an existing quiz or create a new one to save your generated
            questions.
          </p>

          <div className="mb-6 flex gap-2">
            {[
              { id: "create", label: "Create New Quiz" },
              { id: "select", label: "Select Existing Quiz" },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setQuizTab(tab.id);
                  if (tab.id === "create") setSelectedQuizId("");
                }}
                className={`rounded-lg px-5 py-2.5 text-sm font-semibold transition-colors ${
                  quizTab === tab.id
                    ? "bg-primary text-white"
                    : "bg-page text-muted hover:text-ink"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {quizTab === "select" ? (
            <div>
              <label
                htmlFor="quiz-select-dropdown"
                className="mb-2 block font-medium text-ink"
              >
                Choose a quiz:
              </label>
              <select
                id="quiz-select-dropdown"
                value={selectedQuizId}
                onChange={(event) => setSelectedQuizId(event.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-3 focus:border-primary focus:outline-none"
              >
                {quizzesQuery.isPending ? (
                  <option value="">Loading quizzes...</option>
                ) : quizzes.length === 0 ? (
                  <option value="">No quizzes available</option>
                ) : (
                  <>
                    <option value="">Select a quiz...</option>
                    {quizzes.map((quiz) => (
                      <option key={quiz._id} value={quiz._id}>
                        {quiz.name}
                      </option>
                    ))}
                  </>
                )}
              </select>
              {quizzesQuery.isSuccess && quizzes.length === 0 && (
                <p className="mt-4 text-sm text-muted">
                  No quizzes found. Create a new quiz instead.
                </p>
              )}
            </div>
          ) : (
            <div>
              <label htmlFor="quiz-name-input" className="mb-2 block font-medium text-ink">
                Quiz Name <span className="text-danger">*</span>
              </label>
              <input
                id="quiz-name-input"
                type="text"
                value={quizName}
                onChange={(event) => setQuizName(event.target.value)}
                placeholder="Enter quiz name..."
                className="mb-4 w-full rounded-lg border border-gray-300 px-3 py-3 focus:border-primary focus:outline-none"
              />
              <textarea
                value={quizDescription}
                onChange={(event) => setQuizDescription(event.target.value)}
                placeholder="Enter quiz description..."
                rows={3}
                className="mb-5 w-full rounded-lg border border-gray-300 px-3 py-3 focus:border-primary focus:outline-none"
              />

              <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="quiz-release-date"
                    className="mb-2 block font-medium text-ink"
                  >
                    Release Date
                  </label>
                  <input
                    id="quiz-release-date"
                    type="datetime-local"
                    value={releaseDate}
                    onChange={(event) => setReleaseDate(event.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-primary focus:outline-none"
                  />
                </div>
                <div>
                  <label
                    htmlFor="quiz-expire-date"
                    className="mb-2 block font-medium text-ink"
                  >
                    Expire Date
                  </label>
                  <input
                    id="quiz-expire-date"
                    type="datetime-local"
                    value={expireDate}
                    onChange={(event) => setExpireDate(event.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-primary focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="mb-2 block font-medium text-ink">
                  Delivery Format
                </label>
                <DeliveryFormatToggle
                  value={deliveryFormat}
                  onChange={setDeliveryFormat}
                />
              </div>
            </div>
          )}
        </div>
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
                setDraftPrompt(null);
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
                setDraftPrompt(null);
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
