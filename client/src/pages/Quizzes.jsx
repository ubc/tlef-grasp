import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useSelectedCourseId } from "../stores/appStore";
import {
  useQuizzesWithQuestions,
  useUpdateQuiz,
  useDeleteQuiz,
} from "../hooks/useQuizzes";
import { useMyCourseSections } from "../hooks/useSections";
import { useCoInstructorAccess } from "../hooks/useCoInstructorAccess";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { downloadQuizExport } from "../lib/exports";
import { useToast } from "../components/ui/Toast";
import { ConfirmModal } from "../components/ui/Modal";
import { LoadingState, EmptyState } from "../components/ui/states";
import QuizCard from "./quizzes/QuizCard";
import CreateQuizWizard from "./quizzes/CreateQuizWizard";
import ExportQuizModal from "./quizzes/ExportQuizModal";
import ShiftDeadlinesModal from "./quizzes/ShiftDeadlinesModal";

const TABS = [
  { id: "manage-quizzes", label: "Manage Quizzes" },
  { id: "create-quiz", label: "Create New Quiz" },
];

export default function Quizzes() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const showToast = useToast();
  const courseId = useSelectedCourseId();

  const { can } = useCoInstructorAccess();
  const canCreate = can("createQuiz");
  // The shift endpoint is faculty-only.
  const { isFaculty: canShift } = useCurrentUser();
  // Co-instructors can always schedule existing quizzes (Manage tab); creating
  // is a separate, owner-granted permission.
  const tabs = canCreate ? TABS : TABS.filter((tab) => tab.id !== "create-quiz");

  const [activeTab, setActiveTab] = useState("manage-quizzes");
  const [exportQuiz, setExportQuiz] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [shiftOpen, setShiftOpen] = useState(false);

  const { quizzes, isPending } = useQuizzesWithQuestions(courseId);
  // Scheduling is limited to the sections this instructor owns (owner included),
  // so the schedule picker only offers their own sections.
  const { sections } = useMyCourseSections(courseId);
  const targetQuizId = searchParams.get("quiz");

  // Filter against the live list so deleted or other-course quizzes never count.
  const selectedQuizzes = quizzes.filter((q) => selectedIds.has(q.id));
  const toggleSelect = (quizId) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(quizId)) next.delete(quizId);
      else next.add(quizId);
      return next;
    });

  useEffect(() => {
    if (isPending || !targetQuizId) return;
    document.getElementById(`quiz-${targetQuizId}`)?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }, [isPending, targetQuizId]);

  const updateMutation = useUpdateQuiz(courseId, {
    onSuccess: (data, { successMessage }) => {
      if (successMessage) showToast(successMessage, "success");
    },
    onError: (error) => showToast(error.message || "Failed to update quiz", "error"),
  });

  const deleteMutation = useDeleteQuiz(courseId, {
    onSuccess: () => showToast("Quiz deleted successfully", "success"),
    onError: (error) => showToast(error.message || "Failed to delete quiz", "error"),
  });

  const handleExport = async (format) => {
    if (!exportQuiz) return;
    try {
      await downloadQuizExport({ courseId, quiz: exportQuiz, format });
      setExportQuiz(null);
    } catch (error) {
      console.error("Error exporting quiz:", error);
      showToast("Failed to export quiz", "error");
    }
  };

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-8">
      {/* Tabs */}
      <div className="mb-6 flex gap-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`rounded-lg px-5 py-2.5 text-sm font-semibold transition-colors ${
              activeTab === tab.id
                ? "bg-primary text-white"
                : "bg-white text-muted shadow-sm hover:text-ink"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab !== "create-quiz" || !canCreate ? (
        isPending ? (
          <LoadingState label="Loading quizzes..." />
        ) : quizzes.length === 0 ? (
          <EmptyState
            icon="fa-clipboard-list"
            title="No Quizzes Found"
            message="There are no quizzes created for this course yet."
          />
        ) : (
          <>
          {canShift && (
            <div className="sticky top-0 z-10 mb-4 flex flex-wrap items-center gap-3 rounded-xl bg-white px-4 py-3 shadow-sm">
              <span className="text-sm font-medium text-ink">
                {selectedQuizzes.length} of {quizzes.length} selected
              </span>
              <button
                type="button"
                onClick={() =>
                  setSelectedIds(
                    selectedQuizzes.length === quizzes.length
                      ? new Set()
                      : new Set(quizzes.map((q) => q.id))
                  )
                }
                className="text-sm font-medium text-primary hover:underline"
              >
                {selectedQuizzes.length === quizzes.length ? "Clear selection" : "Select all"}
              </button>
              <button
                type="button"
                onClick={() => setShiftOpen(true)}
                disabled={selectedQuizzes.length === 0 || sections.length === 0}
                title={sections.length === 0 ? "You have no sections in this course" : undefined}
                className="ml-auto rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
              >
                <i className="fas fa-calendar-plus mr-1.5" />
                Shift deadlines
              </button>
            </div>
          )}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3">
            {quizzes.map((quiz) => (
              <div
                key={quiz.id}
                id={`quiz-${quiz.id}`}
                className={`scroll-mt-8 rounded-2xl ${targetQuizId === quiz.id ? "ring-2 ring-primary ring-offset-2" : ""}`}
              >
                <QuizCard
                  quiz={quiz}
                  courseId={courseId}
                  sections={sections}
                  selected={selectedIds.has(quiz.id)}
                  onToggleSelect={canShift ? toggleSelect : undefined}
                  onUpdate={(quizId, updates, successMessage) =>
                    updateMutation.mutate({ quizId, updates, successMessage })
                  }
                  onReview={(quizId) =>
                    navigate(`/question-bank?quiz=${quizId}&tab=overview`)
                  }
                  onExport={setExportQuiz}
                  onDelete={setDeleteTarget}
                />
              </div>
            ))}
          </div>
          </>
        )
      ) : (
        <CreateQuizWizard
          courseId={courseId}
          onCreated={() => setActiveTab("manage-quizzes")}
        />
      )}

      <ExportQuizModal
        quiz={exportQuiz}
        onClose={() => setExportQuiz(null)}
        onExport={handleExport}
      />

      <ShiftDeadlinesModal
        open={shiftOpen}
        courseId={courseId}
        quizzes={selectedQuizzes}
        sections={sections}
        onClose={() => setShiftOpen(false)}
        onApplied={() => {
          setShiftOpen(false);
          setSelectedIds(new Set());
        }}
      />

      <ConfirmModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteMutation.mutate(deleteTarget)}
        title="Delete Quiz"
        message="Are you sure you want to delete this quiz? This action cannot be undone."
        danger
      />
    </div>
  );
}
