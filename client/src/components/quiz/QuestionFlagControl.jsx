import { useState } from "react";
import { useToast } from "../ui/Toast";
import { useSubmitQuizQuestionFlag } from "../../hooks/useQuizQuestionFlags";

const REASONS = [
  { value: "unclear", label: "Unclear or confusing" },
  { value: "incorrect", label: "Incorrect answer or content" },
  { value: "inappropriate", label: "Inappropriate or offensive" },
  { value: "typo", label: "Typo or formatting issue" },
  { value: "other", label: "Other issue" },
];

export default function QuestionFlagControl({ quizId, question }) {
  const showToast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("unclear");
  const [comment, setComment] = useState("");
  const submitFlag = useSubmitQuizQuestionFlag({
    onSuccess: () => {
      setOpen(false);
      setComment("");
      showToast("Question flagged for your instructor", "success");
    },
    onError: (error) => showToast(error.message || "Could not flag this question", "error"),
  });

  const submit = (event) => {
    event.preventDefault();
    submitFlag.mutate({
      quizId,
      questionId: question.id,
      reason,
      comment,
      questionText: question.question || question.stem || "",
    });
  };

  return (
    <div className="mt-5 border-t border-gray-100 pt-4">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-danger/5 hover:text-danger"
      >
        <i className="fas fa-flag" /> Report an issue with this question
      </button>

      {open && (
        <form
          onSubmit={submit}
          className="mt-3 rounded-xl border border-danger/20 bg-danger/5 p-4"
        >
          <fieldset>
            <legend className="text-sm font-semibold text-ink">What is the issue?</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {REASONS.map((item) => (
                <label key={item.value} className="flex cursor-pointer items-center gap-2 text-sm text-ink">
                  <input
                    type="radio"
                    name={`flag-reason-${question.id}`}
                    value={item.value}
                    checked={reason === item.value}
                    onChange={() => setReason(item.value)}
                  />
                  {item.label}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="mt-3 block text-sm font-medium text-ink" htmlFor={`flag-comment-${question.id}`}>
            Add details <span className="font-normal text-muted">(optional)</span>
          </label>
          <textarea
            id={`flag-comment-${question.id}`}
            value={comment}
            maxLength={2000}
            onChange={(event) => setComment(event.target.value)}
            rows={3}
            placeholder="Tell your instructor what you noticed."
            className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary focus:outline-none"
          />
          <div className="mt-3 flex items-center gap-3">
            <button
              type="submit"
              disabled={submitFlag.isPending}
              className="rounded-lg bg-danger px-4 py-2 text-sm font-medium text-white hover:bg-danger/90 disabled:opacity-50"
            >
              {submitFlag.isPending ? "Reporting..." : "Report question"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-sm font-medium text-muted hover:text-ink"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
