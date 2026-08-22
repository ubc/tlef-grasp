import { QUESTION_TYPES } from "../../lib/constants";
import { formatQuestionTypeLabel } from "../../lib/utils";

const TYPE_ORDER = [
  QUESTION_TYPES.MULTIPLE_CHOICE,
  QUESTION_TYPES.FILL_IN_THE_BLANK,
  QUESTION_TYPES.CALCULATION,
  QUESTION_TYPES.OPEN_ENDED,
];

// Per-Bloom-level breakdown of how many questions of each type to generate.
// Rendered below the Bloom chip row when a selected chip is expanded.
export default function BloomTypePanel({ bloomLevel, questionTypes, onChangeCount }) {
  const countFor = (type) =>
    questionTypes.find((qt) => qt.questionType === type)?.count || 0;

  return (
    <div className="mt-2 rounded-lg border border-gray-200 bg-page p-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
        Question types for {bloomLevel}
      </div>
      <div className="flex flex-nowrap items-center gap-1.5 overflow-x-auto">
        {TYPE_ORDER.map((type) => {
          const count = countFor(type);
          const label = formatQuestionTypeLabel(type);
          return (
            <div
              key={type}
              className="flex shrink-0 items-center gap-1 rounded-full border border-gray-200 bg-white py-0.5 pl-2 pr-1"
            >
              <span className="text-xs font-medium text-ink">{label}</span>
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  aria-label={`Decrease ${label} count for ${bloomLevel}`}
                  disabled={count <= 0}
                  onClick={() => onChangeCount(type, -1)}
                  className="flex h-5 w-5 items-center justify-center rounded-md border border-gray-200 text-muted transition-colors hover:bg-gray-50 disabled:opacity-30"
                >
                  <i className="fas fa-minus text-[9px]" />
                </button>
                <span className="w-3.5 text-center text-xs font-semibold text-ink">
                  {count}
                </span>
                <button
                  type="button"
                  aria-label={`Increase ${label} count for ${bloomLevel}`}
                  disabled={count >= 5}
                  onClick={() => onChangeCount(type, 1)}
                  className="flex h-5 w-5 items-center justify-center rounded-md border border-gray-200 text-muted transition-colors hover:bg-gray-50 disabled:opacity-30"
                >
                  <i className="fas fa-plus text-[9px]" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
