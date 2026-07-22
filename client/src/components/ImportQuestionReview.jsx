import { formatQuestionTypeLabel } from "../lib/utils";
import { importQuestionLabel } from "../lib/questionImport";

const selectClass =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none";

// Shared review list for the two question-import flows (Add Question → Import,
// Create Quiz → Import). Each parsed question is shown with the objective it
// resolved to, or a required picker when it didn't match. `rows` is
// [{ question, granularId }]; `granularGroups` is [{ metaName, items:[{id,name}] }].
export default function ImportQuestionReview({
  rows,
  granularGroups,
  flatGranularsEmpty,
  objectivesLoading,
  onChangeRow,
}) {
  if (rows.length === 0) return null;

  const unresolvedCount = rows.filter((row) => !row.granularId).length;

  return (
    <div className="space-y-3">
      {unresolvedCount > 0 && (
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <i className="fas fa-circle-info mr-1" />
          {unresolvedCount} question{unresolvedCount === 1 ? "" : "s"} still need a learning
          objective before you can continue.
        </div>
      )}

      {objectivesLoading ? (
        <p className="text-sm text-muted">Loading objectives…</p>
      ) : flatGranularsEmpty ? (
        <p className="text-sm text-danger">
          This course has no granular learning objectives yet. Add objectives before importing
          questions.
        </p>
      ) : (
        <div className="max-h-[45vh] space-y-3 overflow-y-auto pr-1">
          {rows.map((row, index) => {
            const matched = Boolean(row.granularId);
            return (
              <div
                key={index}
                className={`rounded-xl border p-3 ${matched ? "border-gray-200" : "border-amber-300 bg-amber-50/40"}`}
              >
                <div className="mb-2 flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-ink line-clamp-2">
                    {importQuestionLabel(row.question) || "(untitled question)"}
                  </p>
                  <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-muted">
                    {formatQuestionTypeLabel(row.question.questionType || row.question.type)}
                  </span>
                </div>
                <label className="mb-1 block text-xs font-semibold text-ink">
                  Learning Objective{" "}
                  {matched ? (
                    <span className="font-normal text-success">
                      <i className="fas fa-check mr-0.5" />
                      matched
                    </span>
                  ) : (
                    <span className="font-normal text-danger">— required</span>
                  )}
                </label>
                <select
                  aria-label={`Learning objective for question ${index + 1}`}
                  value={row.granularId}
                  onChange={(event) => onChangeRow(index, event.target.value)}
                  className={selectClass}
                >
                  <option value="">— Select a learning objective —</option>
                  {granularGroups.map((group) => (
                    <optgroup key={group.metaName} label={group.metaName}>
                      {group.items.map((granular) => (
                        <option key={granular.id} value={granular.id}>
                          {granular.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
