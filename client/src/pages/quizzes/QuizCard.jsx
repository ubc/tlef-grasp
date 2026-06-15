import { toDatetimeLocal, formatDate } from "../../lib/format";
import DeliveryFormatToggle from "../../components/DeliveryFormatToggle";

export default function QuizCard({ quiz, onUpdate, onReview, onExport, onDelete }) {
  const totalQuestions = quiz.questions.length;
  const approvedQuestions = quiz.questions.filter(
    (q) => q.status === "Approved"
  ).length;
  const progress = totalQuestions > 0 ? (approvedQuestions / totalQuestions) * 100 : 0;
  const deliveryFormat =
    quiz.deliveryFormat === "spaced-3phase" ? "spaced-3phase" : "all-approved";

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-ink">{quiz.name}</h3>
        <div className="text-xs text-muted">Created: {formatDate(quiz.createdAt)}</div>
      </div>

      <div className="mb-4">
        <div className="h-2 overflow-hidden rounded-full bg-gray-100">
          <div
            className="h-full rounded-full bg-success transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="mt-1 text-xs text-muted">{Math.round(progress)}% Approved</div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-semibold text-muted">
            Release Date
          </label>
          <input
            type="datetime-local"
            defaultValue={toDatetimeLocal(quiz.releaseDate)}
            onChange={(event) =>
              onUpdate(quiz.id, { releaseDate: event.target.value || null })
            }
            className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-primary focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-muted">
            Expire Date
          </label>
          <input
            type="datetime-local"
            defaultValue={toDatetimeLocal(quiz.expireDate)}
            onChange={(event) =>
              onUpdate(quiz.id, { expireDate: event.target.value || null })
            }
            className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-primary focus:outline-none"
          />
        </div>
      </div>

      <div className="mb-5">
        <label className="mb-1 block text-xs font-semibold text-muted">
          Delivery Format
        </label>
        <DeliveryFormatToggle
          value={deliveryFormat}
          onChange={(value) => {
            if (value !== deliveryFormat) {
              onUpdate(quiz.id, { deliveryFormat: value }, "Delivery format updated");
            }
          }}
        />
      </div>

      <div className="space-y-2">
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => onReview(quiz.id)}
            className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-dark"
          >
            Review
          </button>
          <button
            type="button"
            onClick={() => onExport(quiz)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-ink transition-colors hover:bg-gray-50"
          >
            Export
          </button>
          <button
            type="button"
            onClick={() => onUpdate(quiz.id, { published: !quiz.published })}
            className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              quiz.published
                ? "bg-warning/15 text-warning hover:bg-warning/25"
                : "bg-success text-white hover:bg-success/85"
            }`}
          >
            {quiz.published ? "Unpublish" : "Publish"}
          </button>
        </div>
        <button
          type="button"
          onClick={() => onDelete(quiz.id)}
          className="w-full rounded-lg border border-danger/40 bg-white px-3 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger/5"
        >
          Delete
        </button>
      </div>
    </div>
  );
}
