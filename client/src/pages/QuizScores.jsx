import { useEffect, useMemo, useState } from "react";
import { useSelectedCourseId } from "../stores/appStore";
import { useCourseQuizzes, useQuizScores } from "../hooks/useQuizzes";
import { formatTimeSpent, formatDateTime } from "../lib/format";
import Pagination from "../components/ui/Pagination";
import ScoreBadge from "./quiz-scores/ScoreBadge";
import StudentReviewModal from "./quiz-scores/StudentReviewModal";

const ITEMS_PER_PAGE = 15;

const headClass =
  "border-b border-gray-200 px-4 py-3 text-left text-sm font-semibold text-muted";
const cellClass = "border-b border-gray-100 px-4 py-3 text-sm";

export default function QuizScores() {
  const courseId = useSelectedCourseId();

  const [selectedQuizId, setSelectedQuizId] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [review, setReview] = useState(null);

  const { quizzes } = useCourseQuizzes(courseId);

  // Default to the first (most recent) quiz once loaded
  useEffect(() => {
    if (!selectedQuizId && quizzes.length > 0) {
      setSelectedQuizId(String(quizzes[0]._id));
    }
  }, [quizzes, selectedQuizId]);

  const { scores, isPending: scoresPending } = useQuizScores(selectedQuizId);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return scores;
    return scores.filter((s) => {
      const name = (s.studentName || "").toLowerCase();
      const email = (s.studentEmail || "").toLowerCase();
      return name.includes(query) || email.includes(query);
    });
  }, [scores, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const currentPage = Math.min(page, totalPages);
  const startIdx = (currentPage - 1) * ITEMS_PER_PAGE;
  const pageData = filtered.slice(startIdx, startIdx + ITEMS_PER_PAGE);

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-8">
      <h1 className="mb-6 text-2xl font-bold text-ink">Quiz Scores</h1>

      {/* Controls */}
      <div className="mb-5 flex flex-wrap items-center gap-4">
        <select
          value={selectedQuizId}
          onChange={(event) => {
            setSelectedQuizId(event.target.value);
            setPage(1);
          }}
          className="min-w-64 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary focus:outline-none"
        >
          {!courseId ? (
            <option value="">No course selected</option>
          ) : quizzes.length === 0 ? (
            <option value="">No quizzes found for this course</option>
          ) : (
            quizzes.map((quiz) => (
              <option key={quiz._id} value={quiz._id}>
                {quiz.name}
              </option>
            ))
          )}
        </select>
        <div className="relative min-w-64 flex-1">
          <i className="fas fa-search absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
          <input
            type="text"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Search by student name or email..."
            className="w-full rounded-lg border border-gray-300 py-2 pr-3 pl-9 text-sm focus:border-primary focus:outline-none"
          />
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className={headClass}>Student</th>
                <th className={headClass}>Email</th>
                <th className={headClass}>Score</th>
                <th className={headClass}>Correct</th>
                <th className={headClass}>Time Spent</th>
                <th className={headClass}>Completed</th>
              </tr>
            </thead>
            <tbody>
              {scoresPending && selectedQuizId ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-muted">
                    <i className="fas fa-circle-notch fa-spin mb-2 text-2xl" />
                    <p>Loading scores...</p>
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-muted">
                    <i className="fas fa-inbox mb-2 text-3xl text-gray-300" />
                    <h3 className="font-semibold text-ink">No Data</h3>
                    <p>
                      {!courseId
                        ? "Please select a course from the sidebar."
                        : !selectedQuizId
                          ? "Please select a quiz to view scores."
                          : "No student scores matched your filters."}
                    </p>
                  </td>
                </tr>
              ) : (
                pageData.map((item, index) => {
                  const taken = item.score !== undefined && item.score !== null;
                  return (
                    <tr
                      key={item.userId || index}
                      title={taken ? "Click to review student answers" : undefined}
                      onClick={
                        taken
                          ? () =>
                              setReview({
                                quizId: selectedQuizId,
                                userId: item.userId,
                                studentName: item.studentName || "Unknown Student",
                                score: item.score,
                              })
                          : undefined
                      }
                      className={taken ? "cursor-pointer hover:bg-gray-50" : ""}
                    >
                      <td className={`${cellClass} font-semibold text-ink`}>
                        {item.studentName || "Unknown Student"}
                      </td>
                      <td className={`${cellClass} text-muted`}>
                        {item.studentEmail || "-"}
                      </td>
                      <td className={cellClass}>
                        <ScoreBadge score={item.score} />
                      </td>
                      <td className={cellClass}>
                        {item.correctAnswers != null
                          ? `${item.correctAnswers} / ${item.totalQuestions}`
                          : "-"}
                      </td>
                      <td className={cellClass}>{formatTimeSpent(item.timeSpent)}</td>
                      <td className={cellClass}>{formatDateTime(item.completedAt)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {filtered.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 px-4 py-3 text-sm text-muted">
            <span>
              Showing {startIdx + 1} to{" "}
              {Math.min(startIdx + ITEMS_PER_PAGE, filtered.length)} of{" "}
              {filtered.length} entries
            </span>
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={setPage}
            />
          </div>
        )}
      </div>

      {review && <StudentReviewModal review={review} onClose={() => setReview(null)} />}
    </div>
  );
}
