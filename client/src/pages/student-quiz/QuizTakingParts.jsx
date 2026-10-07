import { useEffect, useState } from "react";
import { QUESTION_TYPES } from "../../lib/constants";
import { escapeHtml } from "../../lib/format";
import RichText from "../../components/RichText";
import { canRetry, isSolved, latestResult } from "./answerState";
import { optionImageOf, optionIndexOf, optionKeysOf, optionTextOf } from "../../lib/mcOptions";
import { ImageZoomOverlay } from "../../components/QuestionImage";
import { questionImageSrc } from "../../lib/questionImages";

export function Timer({ expiresAt, onExpire }) {
  const [, forceTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => forceTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const remainingSeconds = expiresAt
    ? Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000))
    : 0;

  useEffect(() => {
    if (remainingSeconds === 0 && expiresAt) onExpire?.();
  }, [expiresAt, onExpire, remainingSeconds]);

  const hours = String(Math.floor(remainingSeconds / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((remainingSeconds % 3600) / 60)).padStart(2, "0");
  const seconds = String(remainingSeconds % 60).padStart(2, "0");

  return (
    <span>
      <i className="fas fa-clock mr-1" />
      Time remaining: {hours}:{minutes}:{seconds}
    </span>
  );
}

export function TextAnswerInput({
  question,
  saved,
  feedback,
  onSubmit,
  submitting,
  multiline = false,
  placeholder,
  hint,
}) {
  const [value, setValue] = useState(typeof saved === "string" ? saved : "");
  // A wrong calculation answer stays editable so the student can try again;
  // the input locks once they find the answer, or after the single
  // fill-in-the-blank or open-ended submission.
  const retrying = canRetry(feedback);
  const locked = !!feedback && !retrying;
  const latest = latestResult(feedback);

  // Sync when navigating between questions
  useEffect(() => {
    setValue(typeof saved === "string" ? saved : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question.id]);

  // isCorrect null = awaiting manual grading (neutral); AI-graded open-ended
  // answers carry a boolean and tint like any other graded answer.
  const borderClass = !latest
    ? "border-gray-200"
    : latest.isCorrect === null
      ? "border-primary/50 bg-primary/5"
      : latest.isCorrect
        ? "border-success/60 bg-success/5"
        : "border-danger/60 bg-danger/5";

  const InputTag = multiline ? "textarea" : "input";

  // Calculation answers get the plain text keyboard, not a numeric keypad:
  // phones' decimal keypads have no minus sign, "e" or "x", so negative
  // numbers and scientific notation (1.5e3, 1.5 x 10^3) could not be typed.
  return (
    <div className={`rounded-xl border-2 p-5 ${borderClass}`}>
      <label
        htmlFor={`answer-${question.id}`}
        className="mb-2 block text-sm font-semibold text-ink"
      >
        {multiline ? "Your response" : "Your answer"}
      </label>
      <InputTag
        id={`answer-${question.id}`}
        type={multiline ? undefined : "text"}
        rows={multiline ? 6 : undefined}
        inputMode={hint === "calc" ? "text" : undefined}
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        disabled={locked || submitting}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            (!multiline || event.ctrlKey || event.metaKey)
          ) {
            event.preventDefault();
            if (!locked && !submitting) onSubmit(value);
          }
        }}
        className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-primary focus:outline-none disabled:bg-gray-50"
      />
      <button
        type="button"
        disabled={locked || submitting}
        onClick={() => onSubmit(value)}
        className="mt-3 rounded-lg bg-primary px-5 py-2 font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-50"
      >
        {submitting ? "Checking..." : retrying ? "Try again" : "Submit answer"}
      </button>
    </div>
  );
}

export function McqOptions({ question, feedback, submitting, onSelect }) {
  const questionId = question.id;
  const entry = feedback[questionId];
  const solved = isSolved(entry);
  // Only options the student picked are ever marked — the one they found to
  // be correct and the wrong ones they tried — so a wrong pick never points at
  // the right answer (issue #128).
  const foundKey = solved ? latestResult(entry).selectedKey : null;
  const wrongKeys = entry?.wrongKeys || [];
  // The option image open in the zoom overlay, if any.
  const [zoomedImage, setZoomedImage] = useState(null);

  return (
    <div className="space-y-3">
      {optionKeysOf(question.options).map((key) => {
        // The server maps selectedIndex back to a letter by position in A
        // to H, so the index sent is the letter's, not the row's.
        const index = optionIndexOf(key);
        const optionText = optionTextOf(question.options[key]);
        // An option may be an image alone (issue #146).
        const image = optionImageOf(question.options[key]);
        if (!optionText && !image) return null;

        const triedWrong = wrongKeys.includes(key);
        let stateClass = "border-gray-200 hover:border-primary/50";
        if (key === foundKey) {
          stateClass = "border-success bg-success/5";
        } else if (triedWrong) {
          stateClass = "border-danger bg-danger/5";
        } else if (solved) {
          stateClass = "border-gray-200 opacity-70";
        }

        // The whole option, image included, is the answer button. Zooming has
        // its own button beside it (a button cannot hold another), in the
        // corner, so it never picks the option and stays usable once solved.
        return (
          <div key={key} className="relative">
            <button
              type="button"
              disabled={solved || triedWrong || submitting}
              onClick={() => onSelect(index, key, questionId)}
              className={`flex w-full items-start gap-3 rounded-xl border-2 p-4 text-left transition-colors disabled:cursor-default ${stateClass} ${image ? "pr-14" : ""}`}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-page font-bold text-ink">
                {key}
              </span>
              <div className="min-w-0 flex-1 pt-1">
                {optionText && (
                  <RichText text={escapeHtml(optionText)} className="text-ink" />
                )}
                {image && (
                  // The caption is the image's alt text and part of the
                  // button's name; it is not shown, as it could name the answer.
                  <img
                    src={questionImageSrc(image)}
                    alt={image.caption || ""}
                    loading="lazy"
                    className={`block max-h-56 max-w-full rounded-lg border border-gray-200 bg-white object-contain ${optionText ? "mt-2" : ""}`}
                  />
                )}
              </div>
              {key === foundKey && <span className="sr-only"> (correct)</span>}
              {triedWrong && <span className="sr-only"> (incorrect)</span>}
            </button>
            {image && (
              <button
                type="button"
                onClick={() => setZoomedImage(image)}
                aria-label={`Enlarge the image in option ${key}`}
                title="Enlarge image"
                className="absolute top-3 right-3 flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white text-muted shadow-sm transition-colors hover:border-primary/50 hover:text-primary"
              >
                <i className="fas fa-search-plus" aria-hidden="true" />
              </button>
            )}
          </div>
        );
      })}
      {zoomedImage && (
        <ImageZoomOverlay
          image={zoomedImage}
          showCaption={false}
          onClose={() => setZoomedImage(null)}
        />
      )}
    </div>
  );
}

// Accept/Deny control for an AI grade (issue #76). Shown only for AI-graded
// answers; the default is Accept, so a missing studentGradeReview reads as
// accepted. Denying flags the attempt for the instructor to review.
export function GradeReviewControl({ feedback, questionId, onGradeReview }) {
  if (!onGradeReview || !feedback?.autoGraded) return null;

  const review = feedback.studentGradeReview || "accept";
  const denied = review === "deny";
  const labelId = `grade-review-${questionId}`;

  return (
    <div className="mt-3 border-t border-gray-200 pt-3">
      <p id={labelId} className="text-sm font-medium text-ink">
        Do you agree with this AI grade?
      </p>
      <div
        role="group"
        aria-labelledby={labelId}
        className="mt-2 flex flex-wrap gap-2"
      >
        <button
          type="button"
          aria-pressed={!denied}
          onClick={() => onGradeReview(questionId, "accept")}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-4 py-1.5 text-sm font-medium transition-colors ${
            !denied
              ? "border-success bg-success/10 text-success"
              : "border-gray-300 bg-white text-ink hover:bg-gray-50"
          }`}
        >
          <i className="fas fa-check" aria-hidden="true" /> Accept
        </button>
        <button
          type="button"
          aria-pressed={denied}
          onClick={() => onGradeReview(questionId, "deny")}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-4 py-1.5 text-sm font-medium transition-colors ${
            denied
              ? "border-danger bg-danger/10 text-danger"
              : "border-gray-300 bg-white text-ink hover:bg-gray-50"
          }`}
        >
          <i className="fas fa-flag" aria-hidden="true" /> Deny
        </button>
      </div>
      {denied && (
        <p className="mt-2 text-xs font-medium text-danger" role="status">
          <i className="fas fa-flag mr-1" aria-hidden="true" />
          You flagged this grade for your instructor to review.
        </p>
      )}
    </div>
  );
}

export function FeedbackPanel({ feedback, questionId, onGradeReview, practice = false }) {
  if (!feedback) return null;

  const reviewControl = (
    <GradeReviewControl
      feedback={feedback}
      questionId={questionId}
      onGradeReview={onGradeReview}
    />
  );

  if (
    feedback.openEnded ||
    (feedback.questionType === QUESTION_TYPES.OPEN_ENDED && feedback.isCorrect === null)
  ) {
    const sample = feedback.sampleAnswer != null ? String(feedback.sampleAnswer).trim() : "";
    const criteria =
      feedback.gradingCriteria != null ? String(feedback.gradingCriteria).trim() : "";
    const graded = typeof feedback.isCorrect === "boolean";

    // Open-ended, LLM-graded: verdict + overall feedback + per-criterion
    // breakdown, plus the sample answer for comparison.
    if (graded) {
      const pass = feedback.isCorrect;
      const aiCriteria = Array.isArray(feedback.criteria) ? feedback.criteria : [];
      return (
        <div
          className={`mt-5 rounded-xl border p-5 ${
            pass ? "border-success/40 bg-success/5" : "border-danger/40 bg-danger/5"
          }`}
        >
          <div className={`font-semibold ${pass ? "text-success" : "text-danger"}`}>
            <i className={`fas ${pass ? "fa-check-circle" : "fa-times-circle"} mr-2`} />
            {pass ? "Correct!" : "Incorrect."}
          </div>
          <p className="mt-1 text-xs text-gray-600">
            Graded by AI — your instructor can review and change this grade.
          </p>
          {feedback.feedbackText && (
            <RichText
              text={escapeHtml(feedback.feedbackText)}
              className="mt-2 text-sm text-gray-600"
            />
          )}
          {aiCriteria.length > 0 && (
            <ul className="mt-3 space-y-2">
              {aiCriteria.map((item, index) => (
                <li key={index} className="flex items-start gap-2 text-sm">
                  <i
                    className={`fas mt-0.5 ${
                      item.met ? "fa-check text-success" : "fa-times text-danger"
                    }`}
                    aria-hidden="true"
                  />
                  <span className="text-gray-700">
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
          {sample && (
            <div className="mt-3">
              <div className="text-sm font-semibold text-ink">Sample answer</div>
              <RichText
                text={escapeHtml(sample)}
                className="mt-1 text-sm whitespace-pre-wrap text-gray-600"
              />
            </div>
          )}
          {reviewControl}
        </div>
      );
    }

    // Open-ended, not auto-graded (LLM unavailable) — show sample answer and
    // criteria for self-assessment; the instructor grades it manually.
    return (
      <div className="mt-5 rounded-xl border border-primary/30 bg-primary/5 p-5">
        <div className="mb-2 font-semibold text-ink">
          <i className="fas fa-clipboard-check mr-2 text-primary" />
          Response submitted
        </div>
        <p className="text-sm text-gray-600">
          Your answer was not auto-graded. Compare your response to the sample answer
          and criteria below.
        </p>
        {sample && (
          <div className="mt-3">
            <div className="text-sm font-semibold text-ink">Sample answer</div>
            <RichText
              text={escapeHtml(sample)}
              className="mt-1 text-sm whitespace-pre-wrap text-gray-600"
            />
          </div>
        )}
        {criteria && (
          <div className="mt-3">
            <div className="text-sm font-semibold text-ink">Grading criteria</div>
            <RichText
              text={escapeHtml(criteria)}
              className="mt-1 text-sm whitespace-pre-wrap text-gray-600"
            />
          </div>
        )}
      </div>
    );
  }

  // Multiple-choice, fill-in-the-blank and calculation: the panel describes the
  // latest check. A wrong multiple-choice or calculation answer never shows the
  // correct one (issue #128); the student keeps trying until they find it, and
  // the grade stays on their first answer. Fill-in-the-blank is answered once,
  // so a wrong answer shows the correct one straight away.
  const latest = latestResult(feedback);
  const retrying = canRetry(feedback);
  const correctText =
    !retrying && feedback.correctOptionText != null
      ? String(feedback.correctOptionText).trim()
      : "";

  if (isSolved(feedback)) {
    return (
      <div className="mt-5 rounded-xl border border-success/40 bg-success/5 p-5">
        <div className="font-semibold text-success">
          <i className="fas fa-check-circle mr-2" />
          Correct!
        </div>
        {latest.feedbackText && (
          <RichText
            text={escapeHtml(latest.feedbackText)}
            className="mt-2 text-sm text-gray-600"
          />
        )}
        {feedback.retry && !practice && (
          <p className="mt-2 text-sm text-gray-600">
            Your grade uses your first answer, so this question still counts as missed.
          </p>
        )}
        {reviewControl}
      </div>
    );
  }

  return (
    <div className="mt-5 rounded-xl border border-danger/40 bg-danger/5 p-5">
      <div className="font-semibold text-danger">
        <i className="fas fa-times-circle mr-2" />
        Incorrect.
      </div>
      {correctText && (
        <RichText
          text={`The correct answer is ${escapeHtml(correctText)}.`}
          className="mt-2 text-sm text-gray-600"
        />
      )}
      {latest.feedbackText && (
        <RichText
          text={escapeHtml(latest.feedbackText)}
          className="mt-2 text-sm text-gray-600"
        />
      )}
      {retrying && (
        <p className="mt-2 text-sm text-gray-600">
          Try again until you find the right answer.
          {!practice && " Only your first answer counts toward your grade."}
        </p>
      )}
      {reviewControl}
    </div>
  );
}

export function CompletionScreen({
  completion,
  achievementToasts,
  onRestart,
  onBackToList,
  onPracticeWrong,
  wrongCount = 0,
  submitStatus = "idle",
  onRetrySubmit,
}) {
  const { correct, total, score, openEndedCount, newAchievements, practice } =
    completion;
  const hasPerfectBadge = !practice && score === 100 && total > 0;
  const canPractice = wrongCount > 0 && typeof onPracticeWrong === "function";
  // Until the server confirms the write, everything here is a local tally.
  // Telling a student "you scored 80%" over a submission that never landed is
  // how they end up recorded as never having taken the quiz.
  const saving = !practice && submitStatus === "saving";
  const submitFailed = !practice && submitStatus === "failed";
  const provisional = saving || submitFailed;

  return (
    <div className="mx-auto max-w-2xl p-4 md:p-8">
      <div className="rounded-2xl bg-white p-10 text-center shadow-sm">
        <i
          className={`mb-4 text-5xl ${
            practice ? "fas fa-dumbbell text-primary" : "fas fa-trophy text-warning"
          }`}
        />
        <h2 className="text-2xl font-bold text-ink">
          {practice ? "Practice Round Complete" : "Quiz Complete!"}
        </h2>
        <p className="mt-1 text-muted">
          {practice
            ? "Practice isn't counted toward your grade."
            : "You have completed all questions."}
        </p>

        {saving && (
          <p className="mt-4 text-sm font-medium text-muted" role="status">
            <i className="fas fa-spinner fa-spin mr-2" aria-hidden="true" />
            Recording your result...
          </p>
        )}

        {submitFailed && (
          <div
            className="mt-5 rounded-xl border border-danger/40 bg-danger/5 p-5 text-left"
            role="alert"
          >
            <div className="font-semibold text-danger">
              <i className="fas fa-triangle-exclamation mr-2" aria-hidden="true" />
              Your result was not recorded
            </div>
            <p className="mt-2 text-sm text-gray-700">
              The score below is what this device counted, but it did not reach the
              server, so your instructor will not see it. Stay on this page and try
              again. If it keeps failing, contact your instructor before closing
              this tab.
            </p>
            {typeof onRetrySubmit === "function" && (
              <button
                type="button"
                onClick={onRetrySubmit}
                className="mt-3 inline-flex items-center gap-2 rounded-lg bg-danger px-5 py-2 font-medium text-white transition-colors hover:opacity-90"
              >
                <i className="fas fa-rotate-right" aria-hidden="true" /> Submit again
              </button>
            )}
          </div>
        )}

        {/* Practice rounds report the current session only and omit the score,
            since they don't count toward the grade. */}
        <div className={`my-8 grid gap-4 ${practice ? "grid-cols-2" : "grid-cols-3"}`}>
          <div className="rounded-xl bg-page p-4">
            <div className="text-sm text-muted">Correct Answers:</div>
            <div className="text-2xl font-bold text-ink">{correct}</div>
          </div>
          <div className="rounded-xl bg-page p-4">
            <div className="text-sm text-muted">Total Questions:</div>
            <div className="text-2xl font-bold text-ink">{total}</div>
          </div>
          {!practice && (
            <div className="rounded-xl bg-page p-4">
              <div className="text-sm text-muted">
                {provisional ? "Score (not saved):" : "Score:"}
              </div>
              <div
                className={`text-2xl font-bold ${provisional ? "text-muted" : "text-ink"}`}
              >
                {score === null ? (openEndedCount > 0 ? "—" : "0%") : `${score}%`}
              </div>
            </div>
          )}
        </div>

        {/* Achievements are awarded by the server, so there is nothing to show
            until the submission lands. */}
        {!provisional && (newAchievements.length > 0 || hasPerfectBadge) && (
          <div className="mb-8 inline-flex items-center gap-2 rounded-full bg-warning/15 px-5 py-2.5 font-semibold text-warning">
            {newAchievements.length === 1 ? (
              <>
                <i className={newAchievements[0].icon || "fas fa-trophy"} />
                <span>{newAchievements[0].title}</span>
              </>
            ) : newAchievements.length > 1 ? (
              <>
                <i className="fas fa-trophy" />
                <span>{newAchievements.length} New Achievements!</span>
              </>
            ) : (
              <>
                <i className="fas fa-star" />
                <span>Perfect Score!</span>
              </>
            )}
          </div>
        )}

        <div className="flex flex-wrap justify-center gap-3">
          {canPractice && (
            <button
              type="button"
              onClick={onPracticeWrong}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 font-medium text-white transition-colors hover:bg-primary-dark"
            >
              <i className="fas fa-dumbbell" /> Practice the {wrongCount} you missed
            </button>
          )}
          <button
            type="button"
            onClick={onRestart}
            className={`inline-flex items-center gap-2 rounded-lg px-5 py-2.5 font-medium transition-colors ${
              canPractice
                ? "border border-gray-300 bg-white text-ink hover:bg-gray-50"
                : "bg-primary text-white hover:bg-primary-dark"
            }`}
          >
            <i className="fas fa-redo" /> Restart Quiz
          </button>
          <button
            type="button"
            onClick={onBackToList}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-5 py-2.5 font-medium text-ink transition-colors hover:bg-gray-50"
          >
            <i className="fas fa-arrow-left" /> Back to Quizzes
          </button>
        </div>
      </div>

      {/* Achievement notifications */}
      <div className="fixed top-5 right-5 z-[2000] flex flex-col gap-2.5">
        {achievementToasts.map((achievement, index) => (
          <div
            key={index}
            className={`flex max-w-sm items-center gap-3 rounded-xl px-5 py-4 text-white shadow-lg ${
              achievement.type === "quiz_perfect"
                ? "bg-gradient-to-br from-yellow-400 to-yellow-600"
                : "bg-gradient-to-br from-green-500 to-green-600"
            }`}
          >
            <i className={`${achievement.icon || "fas fa-trophy"} text-2xl`} />
            <div>
              <div className="text-sm font-semibold">Achievement Unlocked!</div>
              <div className="font-bold">{achievement.title}</div>
              <div className="text-xs opacity-90">{achievement.description}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
