import { useState } from "react";
import { useQuizStudentAttempts, useGradeAttempt } from "../../hooks/useQuizzes";
import { QUESTION_TYPES } from "../../lib/constants";
import { escapeHtml } from "../../lib/format";
import Modal from "../../components/ui/Modal";
import RichText from "../../components/RichText";
import { scoreClasses } from "./ScoreBadge";

const TYPE_LABELS = {
  [QUESTION_TYPES.MULTIPLE_CHOICE]: "Multiple Choice",
  [QUESTION_TYPES.FILL_IN_THE_BLANK]: "Fill in the Blank",
  [QUESTION_TYPES.CALCULATION]: "Calculation",
  [QUESTION_TYPES.OPEN_ENDED]: "Open-ended",
};

function AttemptStatus({ attempt, graded }) {
  const isCorrect = graded?.isCorrect ?? attempt.isCorrect;
  const isOpenEnded = attempt.questionType === QUESTION_TYPES.OPEN_ENDED;
  const isReviewableAiType =
    isOpenEnded || attempt.questionType === QUESTION_TYPES.FILL_IN_THE_BLANK;
  // AI-graded and not yet confirmed/overridden by an instructor in this or a
  // previous session.
  const aiGrade =
    isReviewableAiType && attempt.aiGraded && !attempt.gradedAt && !graded;

  if (isOpenEnded && isCorrect === null) {
    return (
      <span className="rounded-full bg-warning/15 px-3 py-1 text-xs font-semibold text-warning">
        <i className="fas fa-clock mr-1" /> Needs Manual Grading
      </span>
    );
  }
  // Only open-ended and AI-rescued fill-in-the-blank carry a reviewable AI
  // grade; multiple-choice/calculation never set aiGraded.
  if (isCorrect) {
    return (
      <span className="text-sm font-semibold text-success">
        <i className="fas fa-check-circle mr-1" /> Correct
        {aiGrade && (
          <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            AI-graded
          </span>
        )}
      </span>
    );
  }
  return (
    <span className="text-sm font-semibold text-danger">
      <i className="fas fa-times-circle mr-1" /> Incorrect
      {aiGrade && (
        <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
          AI-graded
        </span>
      )}
      {!attempt.selectedAnswer &&
        attempt.questionType === QUESTION_TYPES.MULTIPLE_CHOICE && (
          <span className="ml-2 text-xs font-normal text-gray-400">
            (Exact answer wasn't logged)
          </span>
        )}
    </span>
  );
}

// AI feedback block: the judge's overall feedback plus any per-criterion
// breakdown. Shared by open-ended and AI-rescued fill-in-the-blank attempts.
function AiFeedback({ attempt }) {
  const aiCriteria = Array.isArray(attempt.aiCriteria) ? attempt.aiCriteria : [];
  if (!attempt.aiGraded || (!attempt.feedbackText && aiCriteria.length === 0)) {
    return null;
  }
  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
      <strong className="text-ink">
        <i className="fas fa-robot mr-1.5 text-primary" /> AI Feedback
      </strong>
      {attempt.feedbackText && (
        <p className="mt-1 whitespace-pre-wrap text-gray-600">
          {attempt.feedbackText}
        </p>
      )}
      {aiCriteria.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {aiCriteria.map((item, index) => (
            <li key={index} className="flex items-start gap-2">
              <i
                className={`fas mt-0.5 ${
                  item.met ? "fa-check text-success" : "fa-times text-danger"
                }`}
                aria-hidden="true"
              />
              <span className="text-gray-600">
                <span className="font-semibold text-ink">
                  {item.criterion}
                  <span className="sr-only">
                    {item.met ? " — met" : " — not met"}
                  </span>
                  {": "}
                </span>
                {item.comment}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Mark Correct / Mark Incorrect controls, shown when an attempt still needs a
// grade or carries an overridable AI grade. Shared across attempt types.
function GradeControls({ needsGrading, canOverride, grading, onGrade }) {
  if (!needsGrading && !canOverride) return null;
  return (
    <div>
      {canOverride && (
        <p className="mb-2 text-xs text-gray-500">
          This answer was graded by AI. You can override the grade below.
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={grading}
          onClick={() => onGrade(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-success px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-success/85 disabled:opacity-50"
        >
          <i className="fas fa-check" /> Mark Correct
        </button>
        <button
          type="button"
          disabled={grading}
          onClick={() => onGrade(false)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-danger px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-danger/85 disabled:opacity-50"
        >
          <i className="fas fa-times" /> Mark Incorrect
        </button>
      </div>
    </div>
  );
}

function OpenEndedAttempt({ attempt, needsGrading, canOverride, grading, onGrade }) {
  return (
    <div className="space-y-3 text-sm">
      <div>
        <span className="font-semibold text-ink">Student's Response: </span>
        {attempt.selectedAnswer ? (
          <span className="text-gray-700">{attempt.selectedAnswer}</span>
        ) : (
          <em className="text-gray-400">Not recorded</em>
        )}
      </div>
      <AiFeedback attempt={attempt} />
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
              <em className="text-gray-400">No grading criteria provided.</em>
            )}
          </p>
        </div>
      </div>
      <GradeControls
        needsGrading={needsGrading}
        canOverride={canOverride}
        grading={grading}
        onGrade={onGrade}
      />
    </div>
  );
}

function TextAttempt({ attempt, canOverride, grading, onGrade }) {
  return (
    <div className="space-y-2 text-sm">
      <div>
        <span className="font-semibold text-ink">Student's Answer: </span>
        {attempt.selectedAnswer ? (
          <span className={attempt.isCorrect ? "text-success" : "text-danger"}>
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
            <span className="font-semibold text-ink">Correct Answer: </span>
            <span className="text-success">{attempt.correctAnswer}</span>
          </div>
        )}
      {/* AI feedback + override for a fill-in-the-blank answer that went
          through the LLM rescue fallback. */}
      <AiFeedback attempt={attempt} />
      <GradeControls
        needsGrading={false}
        canOverride={canOverride}
        grading={grading}
        onGrade={onGrade}
      />
    </div>
  );
}

function McqAttempt({ attempt }) {
  return (
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
        } else if (key === attempt.selectedAnswer && !attempt.isCorrect) {
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
  );
}

export default function StudentReviewModal({ review, onClose }) {
  const { attempts, isPending, isError } = useQuizStudentAttempts(
    review.quizId,
    review.userId
  );
  const [currentScore, setCurrentScore] = useState(review.score ?? null);
  // questionId -> { isCorrect } for items graded in this session (instant UI)
  const [manualGrades, setManualGrades] = useState({});

  const gradeMutation = useGradeAttempt(review.quizId, review.userId, {
    onSuccess: (data, { questionId, isCorrect }) => {
      setCurrentScore(data.score);
      setManualGrades((prev) => ({ ...prev, [questionId]: { isCorrect } }));
    },
    onError: (error) => console.error("Grading error:", error),
  });

  const effectiveCorrect = (attempt) =>
    manualGrades[attempt.questionId]?.isCorrect ?? attempt.isCorrect;
  const correctCount = attempts.filter(
    (a) => effectiveCorrect(a) === true
  ).length;
  const pendingCount = attempts.filter(
    (a) => effectiveCorrect(a) === null
  ).length;

  return (
    <Modal open onClose={onClose} title={`Review: ${review.studentName}`} wide>
      {isError ? (
        <p className="text-danger">Failed to load attempt data.</p>
      ) : isPending ? (
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
            <span>
              <strong>Correct:</strong> {correctCount} / {attempts.length}
            </span>
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
              // An AI grade can be overridden until an instructor confirms a
              // grade (gradedAt server-side, `manual` within this session).
              // Applies to open-ended and AI-rescued fill-in-the-blank — the
              // only types that set aiGraded.
              const canOverride =
                (isOpenEnded ||
                  attempt.questionType === QUESTION_TYPES.FILL_IN_THE_BLANK) &&
                effectiveCorrect !== null &&
                attempt.aiGraded &&
                !attempt.gradedAt &&
                !manual;
              const isTextType =
                attempt.questionType === QUESTION_TYPES.FILL_IN_THE_BLANK ||
                attempt.questionType === QUESTION_TYPES.CALCULATION;
              const isGrading =
                gradeMutation.isPending &&
                gradeMutation.variables?.questionId === attempt.questionId;
              const onGrade = (isCorrect) =>
                gradeMutation.mutate({ questionId: attempt.questionId, isCorrect });

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
                    <OpenEndedAttempt
                      attempt={attempt}
                      needsGrading={needsGrading}
                      canOverride={canOverride}
                      grading={isGrading}
                      onGrade={onGrade}
                    />
                  ) : isTextType ? (
                    <TextAttempt
                      attempt={attempt}
                      canOverride={canOverride}
                      grading={isGrading}
                      onGrade={onGrade}
                    />
                  ) : (
                    <McqAttempt attempt={attempt} />
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
