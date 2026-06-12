import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { QUESTION_TYPES } from "../lib/constants";
import { useAppStore } from "../stores/appStore";
import Modal from "../components/ui/Modal";
import RichText from "../components/RichText";

const ITEMS_PER_PAGE = 15;

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text ?? "";
  return div.innerHTML;
}

function formatTime(ms) {
  if (!ms) return "-";
  const seconds = Math.floor((ms / 1000) % 60);
  const minutes = Math.floor((ms / (1000 * 60)) % 60);
  const hours = Math.floor(ms / (1000 * 60 * 60));
  let formatted = "";
  if (hours > 0) formatted += `${hours}h `;
  if (minutes > 0 || hours > 0) formatted += `${minutes}m `;
  formatted += `${seconds}s`;
  return formatted;
}

function formatDate(dateString) {
  if (!dateString) return "-";
  return new Date(dateString).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function scoreClasses(score) {
  if (score >= 80) return "bg-green-100 text-green-700";
  if (score >= 60) return "bg-yellow-100 text-yellow-700";
  return "bg-red-100 text-red-700";
}

function ScoreBadge({ score }) {
  if (score === undefined || score === null) {
    return (
      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">
        Not Taken
      </span>
    );
  }
  return (
    <span
      className={`rounded-full px-3 py-1 text-xs font-semibold ${scoreClasses(score)}`}
    >
      {Number(score).toFixed(1)}%
    </span>
  );
}

const TYPE_LABELS = {
  [QUESTION_TYPES.MULTIPLE_CHOICE]: "Multiple Choice",
  [QUESTION_TYPES.FILL_IN_THE_BLANK]: "Fill in the Blank",
  [QUESTION_TYPES.CALCULATION]: "Calculation",
  [QUESTION_TYPES.OPEN_ENDED]: "Open-ended",
};

function AttemptStatus({ attempt, graded }) {
  const isCorrect = graded?.isCorrect ?? attempt.isCorrect;
  const isOpenEnded = attempt.questionType === QUESTION_TYPES.OPEN_ENDED;

  if (isOpenEnded && isCorrect === null) {
    return (
      <span className="rounded-full bg-warning/15 px-3 py-1 text-xs font-semibold text-warning">
        <i className="fas fa-clock mr-1" /> Needs Manual Grading
      </span>
    );
  }
  if (isCorrect) {
    return (
      <span className="text-sm font-semibold text-success">
        <i className="fas fa-check-circle mr-1" /> Correct
      </span>
    );
  }
  return (
    <span className="text-sm font-semibold text-danger">
      <i className="fas fa-times-circle mr-1" /> Incorrect
      {!attempt.selectedAnswer &&
        attempt.questionType === QUESTION_TYPES.MULTIPLE_CHOICE && (
          <span className="ml-2 text-xs font-normal text-gray-400">
            (Exact answer wasn't logged)
          </span>
        )}
    </span>
  );
}

function StudentReviewModal({ review, onClose }) {
  const [attemptsData, setAttemptsData] = useState(null);
  const [error, setError] = useState(null);
  const [currentScore, setCurrentScore] = useState(review?.score ?? null);
  // questionId -> { isCorrect } for manually graded items in this session
  const [manualGrades, setManualGrades] = useState({});
  const [gradingId, setGradingId] = useState(null);

  useEffect(() => {
    if (!review) return;
    setAttemptsData(null);
    setError(null);
    setCurrentScore(review.score ?? null);
    setManualGrades({});
    api
      .get(`/api/quiz/${review.quizId}/student/${review.userId}/attempts`)
      .then((data) => {
        if (!data.success || !data.data) throw new Error("Could not fetch attempt data.");
        setAttemptsData(data.data);
      })
      .catch((err) => {
        console.error("Error fetching review:", err);
        setError("Failed to load attempt data.");
      });
  }, [review]);

  if (!review) return null;

  const attempts = attemptsData || [];
  const openEnded = attempts.filter((a) => a.questionType === QUESTION_TYPES.OPEN_ENDED);
  const graded = attempts.filter((a) => a.questionType !== QUESTION_TYPES.OPEN_ENDED);
  const correctCount = graded.filter((a) => a.isCorrect).length;
  const pendingCount = openEnded.filter(
    (a) => (manualGrades[a.questionId]?.isCorrect ?? a.isCorrect) === null
  ).length;

  const gradeAttempt = async (attempt, isCorrect) => {
    setGradingId(attempt.questionId);
    try {
      const data = await api.put(
        `/api/quiz/${review.quizId}/student/${review.userId}/grade`,
        { questionId: attempt.questionId, isCorrect }
      );
      if (!data.success) throw new Error(data.error || "Grading failed");
      setCurrentScore(data.score);
      setManualGrades((prev) => ({ ...prev, [attempt.questionId]: { isCorrect } }));
    } catch (err) {
      console.error("Grading error:", err);
    } finally {
      setGradingId(null);
    }
  };

  return (
    <Modal open onClose={onClose} title={`Review: ${review.studentName}`} wide>
      {error ? (
        <p className="text-danger">{error}</p>
      ) : !attemptsData ? (
        <p className="text-muted">Loading attempt data...</p>
      ) : attempts.length === 0 ? (
        <p className="text-muted">No recorded questions found for this attempt.</p>
      ) : (
        <div>
          {/* Summary */}
          <div className="mb-5 flex flex-wrap items-center gap-4 text-ink">
            <span>
              <strong>Score:</strong>{" "}
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold ${scoreClasses(currentScore)}`}
              >
                {currentScore !== null ? `${Number(currentScore).toFixed(1)}%` : "—"}
              </span>
            </span>
            {graded.length > 0 && (
              <span>
                <strong>Auto-graded:</strong> {correctCount} / {graded.length} correct
              </span>
            )}
            {pendingCount > 0 && (
              <span className="rounded-full bg-warning/15 px-3 py-1 text-xs font-semibold text-warning">
                <i className="fas fa-pencil-alt mr-1" /> {pendingCount} open-ended —
                manual grading required
              </span>
            )}
          </div>

          {/* Questions */}
          <div className="space-y-5">
            {attempts.map((attempt, index) => {
              const manual = manualGrades[attempt.questionId];
              const isOpenEnded = attempt.questionType === QUESTION_TYPES.OPEN_ENDED;
              const effectiveCorrect = manual?.isCorrect ?? attempt.isCorrect;
              const needsGrading = isOpenEnded && effectiveCorrect === null;

              return (
                <div
                  key={attempt.questionId || index}
                  className={`rounded-xl border p-5 ${
                    isOpenEnded ? "border-primary/30" : "border-gray-200"
                  }`}
                >
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-ink">
                      Question {index + 1}{" "}
                      <span className="ml-2 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-muted">
                        {TYPE_LABELS[attempt.questionType] || "Multiple Choice"}
                      </span>
                    </span>
                    <AttemptStatus
                      attempt={attempt}
                      graded={manual ? { isCorrect: manual.isCorrect } : null}
                    />
                  </div>

                  <RichText
                    text={escapeHtml(attempt.questionText)}
                    className="mb-3 font-medium text-ink"
                  />

                  {isOpenEnded ? (
                    <div className="space-y-3 text-sm">
                      <div>
                        <span className="font-semibold text-ink">
                          Student's Response:{" "}
                        </span>
                        {attempt.selectedAnswer ? (
                          <span className="text-gray-700">{attempt.selectedAnswer}</span>
                        ) : (
                          <em className="text-gray-400">Not recorded</em>
                        )}
                      </div>
                      <div className="rounded-lg bg-page p-4">
                        <div className="mb-2">
                          <strong className="text-ink">Sample Answer:</strong>
                          <p className="mt-1 whitespace-pre-wrap text-gray-600">
                            {attempt.openEndedSampleAnswer || (
                              <em className="text-gray-400">No sample answer provided.</em>
                            )}
                          </p>
                        </div>
                        <div>
                          <strong className="text-ink">Grading Criteria:</strong>
                          <p className="mt-1 whitespace-pre-wrap text-gray-600">
                            {attempt.openEndedGradingCriteria || (
                              <em className="text-gray-400">
                                No grading criteria provided.
                              </em>
                            )}
                          </p>
                        </div>
                      </div>
                      {needsGrading && (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={gradingId === attempt.questionId}
                            onClick={() => gradeAttempt(attempt, true)}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-success px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-success/85 disabled:opacity-50"
                          >
                            <i className="fas fa-check" /> Mark Correct
                          </button>
                          <button
                            type="button"
                            disabled={gradingId === attempt.questionId}
                            onClick={() => gradeAttempt(attempt, false)}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-danger px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-danger/85 disabled:opacity-50"
                          >
                            <i className="fas fa-times" /> Mark Incorrect
                          </button>
                        </div>
                      )}
                    </div>
                  ) : attempt.questionType === QUESTION_TYPES.FILL_IN_THE_BLANK ||
                    attempt.questionType === QUESTION_TYPES.CALCULATION ? (
                    <div className="space-y-2 text-sm">
                      <div>
                        <span className="font-semibold text-ink">Student's Answer: </span>
                        {attempt.selectedAnswer ? (
                          <span
                            className={
                              attempt.isCorrect ? "text-success" : "text-danger"
                            }
                          >
                            {attempt.selectedAnswer}
                          </span>
                        ) : (
                          <em className="text-gray-400">Not recorded</em>
                        )}
                      </div>
                      {attempt.correctAnswer &&
                        (attempt.questionType === QUESTION_TYPES.CALCULATION ||
                          !attempt.isCorrect) && (
                          <div>
                            <span className="font-semibold text-ink">
                              Correct Answer:{" "}
                            </span>
                            <span className="text-success">{attempt.correctAnswer}</span>
                          </div>
                        )}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {["A", "B", "C", "D"].map((key) => {
                        const optionRaw = attempt.options?.[key];
                        const optionText =
                          typeof optionRaw === "object" && optionRaw !== null
                            ? optionRaw.text || ""
                            : optionRaw || "";
                        if (!optionText) return null;

                        let stateClass = "border-gray-200";
                        if (key === attempt.correctAnswer) {
                          stateClass = "border-success bg-success/5";
                        } else if (
                          key === attempt.selectedAnswer &&
                          !attempt.isCorrect
                        ) {
                          stateClass = "border-danger bg-danger/5";
                        }

                        return (
                          <div
                            key={key}
                            className={`flex items-start gap-3 rounded-lg border p-3 ${stateClass}`}
                          >
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-page text-xs font-bold text-ink">
                              {key}
                            </span>
                            <RichText
                              text={escapeHtml(optionText)}
                              className="min-w-0 flex-1 text-sm text-ink"
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Modal>
  );
}

export default function QuizScores() {
  const selectedCourse = useAppStore((state) => state.selectedCourse);
  const courseId = selectedCourse?.id;

  const [selectedQuizId, setSelectedQuizId] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [review, setReview] = useState(null);

  const quizzesQuery = useQuery({
    queryKey: ["quizzes", "course", courseId],
    queryFn: () => api.get(`/api/quiz/course/${courseId}`),
    enabled: !!courseId,
  });
  const quizzes = quizzesQuery.data?.quizzes || [];

  // Default to the first (most recent) quiz once loaded
  useEffect(() => {
    if (!selectedQuizId && quizzes.length > 0) {
      setSelectedQuizId(String(quizzes[0]._id));
    }
  }, [quizzes, selectedQuizId]);

  const scoresQuery = useQuery({
    queryKey: ["quiz-scores", selectedQuizId],
    queryFn: () => api.get(`/api/quiz/${selectedQuizId}/scores`),
    enabled: !!selectedQuizId,
  });
  const scores = scoresQuery.data?.success ? scoresQuery.data.data || [] : [];

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

  const headClass =
    "border-b border-gray-200 px-4 py-3 text-left text-sm font-semibold text-muted";
  const cellClass = "border-b border-gray-100 px-4 py-3 text-sm";

  return (
    <div className="mx-auto max-w-6xl p-8">
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
              {scoresQuery.isPending && selectedQuizId ? (
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
                      <td className={cellClass}>{formatTime(item.timeSpent)}</td>
                      <td className={cellClass}>{formatDate(item.completedAt)}</td>
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
              Showing {startIdx + 1} to {Math.min(startIdx + ITEMS_PER_PAGE, filtered.length)}{" "}
              of {filtered.length} entries
            </span>
            {totalPages > 1 && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={currentPage === 1}
                  onClick={() => setPage(currentPage - 1)}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 transition-colors hover:bg-gray-50 disabled:opacity-40"
                >
                  <i className="fas fa-chevron-left" />
                </button>
                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter(
                    (p) =>
                      totalPages <= 7 ||
                      p === 1 ||
                      p === totalPages ||
                      Math.abs(p - currentPage) <= 2
                  )
                  .map((p, index, arr) => (
                    <span key={p} className="flex items-center">
                      {index > 0 && arr[index - 1] !== p - 1 && (
                        <span className="px-1">...</span>
                      )}
                      <button
                        type="button"
                        onClick={() => setPage(p)}
                        className={`rounded-lg px-3 py-1.5 transition-colors ${
                          p === currentPage
                            ? "bg-primary text-white"
                            : "border border-gray-300 hover:bg-gray-50"
                        }`}
                      >
                        {p}
                      </button>
                    </span>
                  ))}
                <button
                  type="button"
                  disabled={currentPage === totalPages}
                  onClick={() => setPage(currentPage + 1)}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 transition-colors hover:bg-gray-50 disabled:opacity-40"
                >
                  <i className="fas fa-chevron-right" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {review && <StudentReviewModal review={review} onClose={() => setReview(null)} />}
    </div>
  );
}
