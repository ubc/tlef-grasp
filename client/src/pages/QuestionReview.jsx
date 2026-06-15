import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useToast } from "../components/ui/Toast";
import { ConfirmModal } from "../components/ui/Modal";

// NOTE: This page is a faithful port of the legacy question-review.js, which
// operated entirely on hardcoded sample data (no API calls). It is kept for
// parity; the live review workflow happens in the Question Bank.

const SAMPLE_QUESTIONS = [
  {
    id: 1,
    title: "Photosynthesis energy conversion",
    prompt:
      "Which of the following best describes how plants convert light energy into chemical energy during photosynthesis?",
    options: [
      { id: "A", text: "Light energy is directly converted to glucose through a single chemical reaction", isCorrect: false, feedback: "Incorrect — Photosynthesis involves multiple complex reactions, not a single conversion" },
      { id: "B", text: "Chlorophyll absorbs light, which excites electrons that drive ATP and NADPH production", isCorrect: true, feedback: "Correct — This describes the light-dependent reactions of photosynthesis" },
      { id: "C", text: "Carbon dioxide and water combine spontaneously to form organic compounds", isCorrect: false, feedback: "Incorrect — This reaction requires energy input and is not spontaneous" },
      { id: "D", text: "Oxygen is the primary product that stores the converted energy", isCorrect: false, feedback: "Incorrect — Oxygen is a byproduct; glucose stores the energy" },
    ],
    status: "unpublished",
    flagged: false,
    history: [
      { by: "Dr. Smith", change: "Created question", ts: "2025-01-15 14:30" },
      { by: "Dr. Johnson", change: "Revised prompt text", ts: "2025-01-16 09:15" },
    ],
    comments: [
      { by: "Dr. Smith", text: "Good question structure, but consider adding more context about the Calvin cycle", ts: "2025-01-15 16:45" },
    ],
  },
  {
    id: 2,
    title: "ΔH and Spontaneity",
    prompt: "Under what conditions is a reaction spontaneous when ΔH is positive?",
    options: [
      { id: "A", text: "When ΔS is negative and T is low", isCorrect: false, feedback: "Incorrect — Negative ΔS and low T would make ΔG more positive" },
      { id: "B", text: "When ΔS is positive and T is high", isCorrect: true, feedback: "Correct — High temperature can overcome positive ΔH if ΔS is positive" },
      { id: "C", text: "When ΔG is always positive regardless of temperature", isCorrect: false, feedback: "Incorrect — ΔG must be negative for spontaneity" },
      { id: "D", text: "When the reaction is exothermic", isCorrect: false, feedback: "Incorrect — Exothermic reactions have negative ΔH" },
    ],
    status: "ready",
    flagged: false,
    history: [
      { by: "Dr. Johnson", change: "Created question", ts: "2025-01-14 11:20" },
      { by: "Dr. Smith", change: "Approved for publication", ts: "2025-01-16 10:30" },
    ],
    comments: [
      { by: "Dr. Johnson", text: "This question tests understanding of Gibbs free energy relationship", ts: "2025-01-14 11:25" },
    ],
  },
  {
    id: 3,
    title: "Define Microstate",
    prompt: "What is a microstate in statistical mechanics?",
    options: [
      { id: "A", text: "A specific arrangement of particles with defined positions and momenta", isCorrect: true, feedback: "Correct — A microstate is a specific microscopic configuration" },
      { id: "B", text: "The average energy of all particles in a system", isCorrect: false, feedback: "Incorrect — This describes macroscopic properties, not microstates" },
      { id: "C", text: "A state of matter (solid, liquid, gas)", isCorrect: false, feedback: "Incorrect — These are macroscopic phases, not microstates" },
      { id: "D", text: "The total number of particles in a system", isCorrect: false, feedback: "Incorrect — This is a system property, not a microstate" },
    ],
    status: "unpublished",
    flagged: true,
    history: [{ by: "Dr. Wilson", change: "Created question", ts: "2025-01-13 15:40" }],
    comments: [
      { by: "Dr. Wilson", text: "Flagged for review - may need clearer distinction between micro and macro states", ts: "2025-01-13 15:45" },
    ],
  },
];

export default function QuestionReview() {
  const navigate = useNavigate();
  const showToast = useToast();

  const [questions, setQuestions] = useState(SAMPLE_QUESTIONS);
  const [currentId, setCurrentId] = useState(SAMPLE_QUESTIONS[0].id);
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [commentText, setCommentText] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);

  const question = questions.find((q) => q.id === currentId) || questions[0];

  const updateQuestion = (id, updates) => {
    setQuestions((prev) => prev.map((q) => (q.id === id ? { ...q, ...updates } : q)));
  };

  const handleEditToggle = () => {
    if (editMode) {
      updateQuestion(question.id, {
        title: editForm.title.trim(),
        prompt: editForm.prompt.trim(),
        options: question.options.map((opt) => ({
          ...opt,
          text: editForm.options[opt.id] ?? opt.text,
        })),
      });
      setEditMode(false);
      showToast("Question updated successfully", "success");
    } else {
      setEditForm({
        title: question.title,
        prompt: question.prompt,
        options: Object.fromEntries(question.options.map((o) => [o.id, o.text])),
      });
      setEditMode(true);
    }
  };

  const handleFlag = () => {
    const flagged = !question.flagged;
    updateQuestion(question.id, { flagged });
    showToast(flagged ? "Question flagged" : "Question unflagged", "success");
  };

  const handleApprove = () => {
    if (question.status === "unpublished") {
      updateQuestion(question.id, { status: "ready" });
      showToast("Question approved", "success");
    } else if (question.status === "ready") {
      updateQuestion(question.id, { status: "unpublished" });
      showToast("Approval removed", "success");
    }
  };

  const confirmDelete = () => {
    const index = questions.findIndex((q) => q.id === question.id);
    const remaining = questions.filter((q) => q.id !== question.id);
    if (remaining.length === 0) {
      navigate("/question-bank?tab=review");
      return;
    }
    setQuestions(remaining);
    setCurrentId(remaining[Math.min(index, remaining.length - 1)].id);
    setEditMode(false);
    showToast("Question deleted", "success");
  };

  const handleAddComment = () => {
    const text = commentText.trim();
    if (!text) return;
    updateQuestion(question.id, {
      comments: [
        ...question.comments,
        { by: "Current User", text, ts: new Date().toLocaleString() },
      ],
    });
    setCommentText("");
    showToast("Comment added", "success");
  };

  const sortQuestions = (dir) => {
    setQuestions((prev) =>
      [...prev].sort((a, b) =>
        dir === "asc" ? a.title.localeCompare(b.title) : b.title.localeCompare(a.title)
      )
    );
  };

  return (
    <div className="mx-auto max-w-7xl p-4 md:p-8">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <button
          type="button"
          onClick={() => navigate("/question-bank?tab=review")}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-gray-50"
        >
          <i className="fas fa-arrow-left" /> Back
        </button>
        <button
          type="button"
          disabled={question.status !== "ready"}
          onClick={() => setPublishOpen(true)}
          className="rounded-lg bg-success px-5 py-2 font-medium text-white transition-colors hover:bg-success/85 disabled:opacity-40"
        >
          Publish
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[280px_1fr_300px]">
        {/* Questions list sidebar */}
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-semibold text-ink">Questions</h3>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => sortQuestions("asc")}
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-gray-100"
                aria-label="Sort ascending"
              >
                <i className="fas fa-sort-alpha-down text-sm" />
              </button>
              <button
                type="button"
                onClick={() => sortQuestions("desc")}
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-gray-100"
                aria-label="Sort descending"
              >
                <i className="fas fa-sort-alpha-up text-sm" />
              </button>
            </div>
          </div>
          <div className="space-y-2">
            {questions.map((q) => (
              <button
                key={q.id}
                type="button"
                onClick={() => {
                  setCurrentId(q.id);
                  setEditMode(false);
                }}
                className={`w-full rounded-lg border p-3 text-left transition-colors ${
                  q.id === question.id
                    ? "border-primary bg-primary/5"
                    : "border-gray-200 hover:border-primary/40"
                }`}
              >
                <div className="text-sm font-medium text-ink">{q.title}</div>
                <span
                  className={`mt-1.5 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${
                    q.flagged
                      ? "bg-red-100 text-red-700"
                      : q.status === "ready"
                        ? "bg-green-100 text-green-700"
                        : q.status === "published"
                          ? "bg-blue-100 text-blue-700"
                          : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {q.flagged ? "Flagged" : q.status}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Question card */}
        <div className="rounded-2xl bg-white p-6 shadow-sm">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            {editMode ? (
              <input
                type="text"
                value={editForm.title}
                onChange={(event) =>
                  setEditForm((prev) => ({ ...prev, title: event.target.value }))
                }
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-lg font-semibold focus:border-primary focus:outline-none"
              />
            ) : (
              <h2 className="text-lg font-semibold text-ink">
                {question.title}
                {question.flagged && (
                  <span className="ml-2 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700">
                    Flagged
                  </span>
                )}
              </h2>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleEditToggle}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-gray-50"
              >
                <i className={`fas ${editMode ? "fa-save" : "fa-pencil"}`} />
                {editMode ? "Save" : "Edit"}
              </button>
              <button
                type="button"
                onClick={handleFlag}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-gray-50"
              >
                <i className="fas fa-flag" /> {question.flagged ? "Unflag" : "Flag"}
              </button>
              <button
                type="button"
                onClick={handleApprove}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-gray-50"
              >
                <i className="fas fa-check" />
                {question.status === "ready" ? "Unapprove" : "Approve"}
              </button>
              <button
                type="button"
                onClick={() => setDeleteOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-danger/40 px-3 py-1.5 text-sm font-medium text-danger transition-colors hover:bg-danger/5"
              >
                <i className="fas fa-trash" /> Delete
              </button>
            </div>
          </div>

          {editMode ? (
            <textarea
              value={editForm.prompt}
              onChange={(event) =>
                setEditForm((prev) => ({ ...prev, prompt: event.target.value }))
              }
              rows={3}
              className="mb-5 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-primary focus:outline-none"
            />
          ) : (
            <p className="mb-5 text-gray-700">{question.prompt}</p>
          )}

          <div className="space-y-3">
            {question.options.map((option) => (
              <div
                key={option.id}
                className={`rounded-xl border-2 p-4 ${
                  option.isCorrect ? "border-success bg-success/5" : "border-gray-200"
                }`}
              >
                <div className="flex items-start gap-3">
                  <span className="font-bold text-ink">{option.id}.</span>
                  <div className="min-w-0 flex-1">
                    {editMode ? (
                      <textarea
                        value={editForm.options[option.id]}
                        onChange={(event) =>
                          setEditForm((prev) => ({
                            ...prev,
                            options: { ...prev.options, [option.id]: event.target.value },
                          }))
                        }
                        rows={2}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none"
                      />
                    ) : (
                      <div className="text-ink">{option.text}</div>
                    )}
                    <div className="mt-1 text-sm text-muted">{option.feedback}</div>
                  </div>
                  {option.isCorrect && (
                    <span className="rounded-full bg-success px-2.5 py-0.5 text-xs font-semibold text-white">
                      Correct
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* History + comments */}
        <div className="space-y-6">
          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <h3 className="mb-3 font-semibold text-ink">Edit History</h3>
            <div className="space-y-3">
              {question.history.map((item, index) => (
                <div key={index} className="text-sm">
                  <div>
                    <span className="font-semibold text-ink">{item.by}</span>{" "}
                    <span className="text-gray-600">{item.change}</span>
                  </div>
                  <div className="text-xs text-muted">{item.ts}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <h3 className="mb-3 font-semibold text-ink">Comments</h3>
            <div className="mb-4 space-y-3">
              {question.comments.map((comment, index) => (
                <div key={index} className="rounded-lg bg-page p-3 text-sm">
                  <div className="mb-1 flex justify-between">
                    <span className="font-semibold text-ink">{comment.by}</span>
                    <span className="text-xs text-muted">{comment.ts}</span>
                  </div>
                  <div className="text-gray-600">{comment.text}</div>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={commentText}
                onChange={(event) => setCommentText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") handleAddComment();
                }}
                placeholder="Add a comment..."
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none"
              />
              <button
                type="button"
                onClick={handleAddComment}
                className="rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-dark"
              >
                Add
              </button>
            </div>
          </div>
        </div>
      </div>

      <ConfirmModal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={confirmDelete}
        title="Delete Question"
        message={`Are you sure you want to delete "${question.title}"? This action cannot be undone.`}
        danger
      />
      <ConfirmModal
        open={publishOpen}
        onClose={() => setPublishOpen(false)}
        onConfirm={() => {
          updateQuestion(question.id, { status: "published" });
          showToast("Question published", "success");
        }}
        title="Publish Question"
        message="Publish this question now?"
      />
    </div>
  );
}
