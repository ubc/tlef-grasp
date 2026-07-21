import { useState } from "react";
import { useSelectedCourseId } from "../stores/appStore";
import {
  useCourseQuizQuestionFlags,
  useUpdateQuizQuestionFlagStatus,
} from "../hooks/useQuizQuestionFlags";
import { useUpdateQuestion } from "../hooks/useQuestions";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { useToast } from "../components/ui/Toast";
import { formatDateTime } from "../lib/format";
import QuestionEditModal from "./question-bank/QuestionEditModal";

const STATUSES = ["pending", "reviewed", "resolved", "dismissed"];

export default function QuestionFlags() {
  const courseId = useSelectedCourseId();
  const showToast = useToast();
  const { isFaculty } = useCurrentUser();
  const [statusFilter, setStatusFilter] = useState("pending");
  const [editTarget, setEditTarget] = useState(null);
  const { flags, isPending } = useCourseQuizQuestionFlags(courseId);
  const updateStatus = useUpdateQuizQuestionFlagStatus({
    onSuccess: () => showToast("Report status updated", "success"),
    onError: (error) => showToast(error.message || "Could not update report", "error"),
  });
  const updateQuestion = useUpdateQuestion(courseId, {
    onSuccess: (data, variables) => {
      if (variables.successMessage) showToast(variables.successMessage, "success");
    },
    onError: (error, variables) =>
      showToast(variables?.errorMessage || error.message || "Failed to update question", "error"),
  });

  // Staff cannot edit approved questions; faculty can edit everything.
  const canEditQuestion = (flag) =>
    isFaculty || (flag.questionStatus || "Draft").toLowerCase() !== "approved";

  const toggleApproval = (flag, approve) => {
    updateQuestion.mutate({
      questionId: flag.questionId,
      updates: { status: approve ? "Approved" : "Draft" },
      successMessage: `Question ${approve ? "approved" : "unapproved"} successfully`,
      errorMessage: "Failed to update question status",
    });
  };

  const toggleFlag = (flag) => {
    const newFlag = !flag.questionFlagged;
    updateQuestion.mutate({
      questionId: flag.questionId,
      updates: { flagStatus: newFlag },
      successMessage: `Question ${newFlag ? "flagged" : "unflagged"} in the bank`,
      errorMessage: "Failed to update question flag status",
    });
  };

  const visibleFlags = statusFilter ? flags.filter((flag) => flag.status === statusFilter) : flags;

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-ink">Student Question Flags</h1>
          <p className="mt-1 text-muted">Review questions that students reported during quizzes.</p>
        </div>
        <label className="text-sm font-medium text-ink">
          Status
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="ml-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-normal focus:border-primary focus:outline-none"
          >
            <option value="">All reports</option>
            {STATUSES.map((status) => <option key={status} value={status}>{status[0].toUpperCase() + status.slice(1)}</option>)}
          </select>
        </label>
      </div>

      {!courseId ? (
        <EmptyState text="Select a course from the sidebar to view student reports." />
      ) : isPending ? (
        <EmptyState loading text="Loading student reports..." />
      ) : visibleFlags.length === 0 ? (
        <EmptyState text={statusFilter ? `No ${statusFilter} reports for this course.` : "No student reports for this course."} />
      ) : (
        <div className="space-y-4">
          {visibleFlags.map((flag) => (
            <article key={flag._id} className="rounded-2xl bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="font-semibold text-ink">{flag.quizName}</div>
                  <div className="mt-1 text-sm text-muted">
                    {flag.studentName || "Unknown student"} · Reported {formatDateTime(flag.updatedAt)}
                  </div>
                </div>
                <label className="text-sm font-medium text-ink">
                  <span className="sr-only">Report status</span>
                  <select
                    value={flag.status}
                    disabled={updateStatus.isPending}
                    onChange={(event) => updateStatus.mutate({ flagId: flag._id, status: event.target.value })}
                    className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium capitalize focus:border-primary focus:outline-none disabled:opacity-50"
                  >
                    {STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
                  </select>
                </label>
              </div>
              {flag.questionText && (
                <div className="mt-4 rounded-lg bg-page p-3 text-sm text-ink whitespace-pre-wrap">
                  {flag.questionText}
                </div>
              )}
              <p className="mt-4 text-sm text-ink">
                <span className="font-semibold">Issue:</span> {flag.reason.replace("-", " ")}
              </p>
              {flag.comment && (
                <p className="mt-2 whitespace-pre-wrap text-sm text-muted">{flag.comment}</p>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-4">
                {!flag.questionExists ? (
                  <span className="text-xs italic text-muted">
                    <i className="fas fa-unlink mr-1" />
                    This question has been deleted from the question bank.
                  </span>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        setEditTarget({ id: flag.questionId, canEdit: canEditQuestion(flag) })
                      }
                      className="inline-flex items-center gap-1.5 rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-gray-200"
                    >
                      <i className="fas fa-eye" />
                      {canEditQuestion(flag) ? "View / Edit question" : "View question"}
                    </button>

                    {isFaculty && (
                      <>
                        {(flag.questionStatus || "").toLowerCase() === "approved" ? (
                          <button
                            type="button"
                            disabled={updateQuestion.isPending}
                            onClick={() => toggleApproval(flag, false)}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-warning/15 px-3 py-1.5 text-xs font-medium text-warning transition-colors hover:bg-warning/25 disabled:opacity-50"
                          >
                            <i className="fas fa-times-circle" /> Unapprove
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={updateQuestion.isPending}
                            onClick={() => toggleApproval(flag, true)}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-success/10 px-3 py-1.5 text-xs font-medium text-success transition-colors hover:bg-success/20 disabled:opacity-50"
                          >
                            <i className="fas fa-check-circle" /> Approve
                          </button>
                        )}

                        <button
                          type="button"
                          disabled={updateQuestion.isPending}
                          onClick={() => toggleFlag(flag)}
                          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                            flag.questionFlagged
                              ? "bg-danger/10 text-danger hover:bg-danger/20"
                              : "bg-gray-100 text-muted hover:bg-gray-200"
                          }`}
                        >
                          <i className="fas fa-flag" />
                          {flag.questionFlagged ? "Unflag in bank" : "Flag in bank"}
                        </button>
                      </>
                    )}

                    {flag.questionExists && (
                      <span
                        className={`ml-auto rounded-full px-2.5 py-1 text-xs font-semibold ${
                          (flag.questionStatus || "").toLowerCase() === "approved"
                            ? "bg-green-100 text-green-700"
                            : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {flag.questionStatus || "Draft"}
                      </span>
                    )}
                  </>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      {editTarget && (
        <QuestionEditModal
          questionId={editTarget.id}
          canEdit={editTarget.canEdit}
          courseId={courseId}
          onClose={() => setEditTarget(null)}
        />
      )}
    </div>
  );
}

function EmptyState({ text, loading = false }) {
  return (
    <div className="rounded-2xl bg-white py-16 text-center shadow-sm">
      <i className={`fas ${loading ? "fa-circle-notch fa-spin" : "fa-flag"} mb-3 text-3xl text-gray-300`} />
      <p className="text-muted">{text}</p>
    </div>
  );
}
