import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSelectedCourseId } from "../stores/appStore";
import {
  useQuizzesWithQuestions,
  useUpdateQuiz,
  useDeleteQuiz,
} from "../hooks/useQuizzes";
import { useMyCourseSections } from "../hooks/useSections";
import { useCoInstructorAccess } from "../hooks/useCoInstructorAccess";
import { downloadQuizExport } from "../lib/exports";
import { useToast } from "../components/ui/Toast";
import { ConfirmModal } from "../components/ui/Modal";
import { LoadingState, EmptyState } from "../components/ui/states";
import QuizCard from "./quizzes/QuizCard";
import CreateQuizWizard from "./quizzes/CreateQuizWizard";
import ExportQuizModal from "./quizzes/ExportQuizModal";

const TABS = [
  { id: "manage-quizzes", label: "Manage Quizzes" },
  { id: "create-quiz", label: "Create New Quiz" },
];

export default function Quizzes() {
  const navigate = useNavigate();
  const showToast = useToast();
  const courseId = useSelectedCourseId();

  const { can } = useCoInstructorAccess();
  const canCreate = can("createQuiz");
  // Co-instructors can always schedule existing quizzes (Manage tab); creating
  // is a separate, owner-granted permission.
  const tabs = canCreate ? TABS : TABS.filter((tab) => tab.id !== "create-quiz");

  const [activeTab, setActiveTab] = useState("manage-quizzes");
  const [exportQuiz, setExportQuiz] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const { quizzes, isPending } = useQuizzesWithQuestions(courseId);
  // Scheduling is limited to the sections this instructor owns (owner included),
  // so the schedule picker only offers their own sections.
  const { sections } = useMyCourseSections(courseId);

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
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3">
            {quizzes.map((quiz) => (
              <QuizCard
                key={quiz.id}
                quiz={quiz}
                courseId={courseId}
                sections={sections}
                onUpdate={(quizId, updates, successMessage) =>
                  updateMutation.mutate({ quizId, updates, successMessage })
                }
                onReview={(quizId) =>
                  navigate(`/question-bank?quiz=${quizId}&status=Draft&tab=overview`)
                }
                onExport={setExportQuiz}
                onDelete={setDeleteTarget}
              />
            ))}
          </div>
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
