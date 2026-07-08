import { useSelectedCourse } from "../../stores/appStore";
import { useStudentQuizList } from "../../hooks/useStudentQuizzes";
import { LoadingState, EmptyState } from "../../components/ui/states";

function QuizListCard({ quiz, completed, onStart }) {
  const hasPerfect = quiz.achievements.some((a) => a.type === "quiz_perfect");
  const disabled = !quiz.questionCount;

  return (
    <div className="flex flex-col rounded-2xl bg-white p-6 shadow-sm">
      <div className="mb-2 flex items-start justify-between gap-3">
        <h3 className="text-lg font-semibold text-ink">{quiz.name || "Unnamed Quiz"}</h3>
        <div className="flex gap-1.5">
          {completed && (
            <span
              title="Quiz Completed"
              className="flex h-7 w-7 items-center justify-center rounded-full bg-green-100 text-green-600"
            >
              <i className="fas fa-check-circle text-sm" />
            </span>
          )}
          {hasPerfect && (
            <span
              title="Perfect Score"
              className="flex h-7 w-7 items-center justify-center rounded-full bg-yellow-100 text-yellow-600"
            >
              <i className="fas fa-star text-sm" />
            </span>
          )}
        </div>
      </div>

      <p className="mb-3 text-sm text-muted">
        {quiz.description || "No description available"}
      </p>

      <div className="mb-3 space-y-1.5 text-sm text-muted">
        <div>
          <i className="fas fa-calendar-alt mr-1.5" />
          Released:{" "}
          {quiz.releaseDate ? new Date(quiz.releaseDate).toLocaleDateString() : "Not set"}
        </div>
        {quiz.expireDate && (
          <div className="text-warning">
            <i className="fas fa-clock mr-1.5" />
            Due: {new Date(quiz.expireDate).toLocaleDateString()}
          </div>
        )}
      </div>

      <div className="mb-4 flex flex-wrap gap-2 text-xs font-medium">
        {quiz.deliveryFormat === "spaced-3phase" ? (
          <>
            <span
              title="One question per granular learning objective"
              className="rounded-full bg-blue-100 px-2.5 py-1 text-blue-700"
            >
              <i className="fas fa-book mr-1" /> {quiz.phase1Count || 0} New
            </span>
            <span
              title="Remediation Questions"
              className="rounded-full bg-orange-100 px-2.5 py-1 text-orange-700"
            >
              <i className="fas fa-fire-alt mr-1" /> {quiz.phase2Count || 0} Remediation
            </span>
            <span
              title="Spaced Learning Questions"
              className="rounded-full bg-purple-100 px-2.5 py-1 text-purple-700"
            >
              <i className="fas fa-history mr-1" /> {quiz.phase3Count || 0} Review
            </span>
          </>
        ) : (
          <span
            title="Total Questions"
            className="rounded-full bg-blue-100 px-2.5 py-1 text-blue-700"
          >
            <i className="fas fa-list-ol mr-1" /> {quiz.questionCount || 0} Question
            {(quiz.questionCount || 0) === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {(completed || hasPerfect) && (
        <div className="mb-4 flex flex-wrap gap-3 text-xs font-medium">
          {completed && (
            <span className="text-green-800">
              <i className="fas fa-check-circle mr-1" /> Completed
            </span>
          )}
          {hasPerfect && (
            <span className="text-yellow-800">
              <i className="fas fa-star mr-1" /> Perfect Score
            </span>
          )}
        </div>
      )}

      <button
        type="button"
        disabled={disabled}
        onClick={onStart}
        className="mt-auto inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 font-medium text-white transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
      >
        <i className="fas fa-play" />
        {completed ? "Retake Quiz" : "Start Quiz"}
      </button>
    </div>
  );
}

function QuizGrid({ quizzes, completedQuizIds, onStart }) {
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
      {quizzes.map((quiz) => (
        <QuizListCard
          key={quiz.id}
          quiz={quiz}
          completed={completedQuizIds.includes(quiz.id)}
          onStart={() => onStart(quiz.id)}
        />
      ))}
    </div>
  );
}

export default function QuizList({ onStart }) {
  const selectedCourse = useSelectedCourse();
  const courseId = selectedCourse?.id;

  const { quizzes, completedQuizIds, isPending, isError } =
    useStudentQuizList(courseId);

  const pending = quizzes.filter(
    (q) => !q.achievements.some((a) => a.type === "quiz_completed")
  );
  const completed = quizzes.filter((q) =>
    q.achievements.some((a) => a.type === "quiz_completed")
  );

  const emptyMessage = !courseId
    ? "No course selected. Please select a course first."
    : isError
      ? "Error loading quizzes. Please try again."
      : "No published quizzes available for this course.";

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-8">
      <h1 className="text-2xl font-bold text-ink">Available Quizzes</h1>
      <p className="mb-6 text-muted">{selectedCourse?.name || "Unknown Course"}</p>

      {courseId && isPending ? (
        <LoadingState label="Loading quizzes..." />
      ) : quizzes.length === 0 ? (
        <EmptyState
          icon="fa-clipboard-list"
          title="No Quizzes Available"
          message={emptyMessage}
        />
      ) : (
        <div className="space-y-10">
          {pending.length > 0 && (
            <section>
              <h2 className="mb-4 text-lg font-semibold text-ink">Pending Quizzes</h2>
              <QuizGrid
                quizzes={pending}
                completedQuizIds={completedQuizIds}
                onStart={onStart}
              />
            </section>
          )}
          {completed.length > 0 && (
            <section>
              <h2 className="mb-4 text-lg font-semibold text-ink">Completed Quizzes</h2>
              <QuizGrid
                quizzes={completed}
                completedQuizIds={completedQuizIds}
                onStart={onStart}
              />
            </section>
          )}
        </div>
      )}
    </div>
  );
}
