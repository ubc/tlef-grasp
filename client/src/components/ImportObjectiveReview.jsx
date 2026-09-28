// Checkbox list of the learning objectives an imported file carried, rendered
// above the question rows. Checkboxes sit on the granular rows; a meta is a
// heading, created implicitly when any child under it is checked. Collapses to a
// confirmation line when the course already has every objective in the file.
export default function ImportObjectiveReview({ groups, checkedKeys, onToggle, onToggleAll }) {
  if (!groups || groups.length === 0) return null;

  const creatable = groups.flatMap((group) =>
    group.granulars.filter((granular) => !granular.existingId)
  );
  if (creatable.length === 0) {
    return (
      <div className="rounded-lg bg-success/10 px-3 py-2 text-sm text-success">
        <i className="fas fa-check mr-1" />
        Every learning objective in this file already exists in this course.
      </div>
    );
  }

  const checkedCount = creatable.filter((granular) => checkedKeys.has(granular.key)).length;
  const allChecked = checkedCount === creatable.length;

  return (
    <div className="rounded-xl border border-gray-200 p-3">
      <div className="mb-2 flex items-start justify-between gap-2">
        <p className="text-xs text-muted">
          <span className="block text-sm font-semibold text-ink">
            Learning objectives in this file
          </span>
          Checked objectives are created before the questions save. Uncheck one to file
          its questions under an objective you already have. Note that imported objectives arrive
          with no course materials attached.
        </p>
        <button
          type="button"
          onClick={() => onToggleAll(!allChecked)}
          className="shrink-0 rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-ink transition-colors hover:bg-gray-50"
        >
          {allChecked ? "Uncheck all" : "Check all"}
        </button>
      </div>

      <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
        {groups.map((group) => (
          <div key={group.metaKey || group.metaName}>
            <p className="text-xs font-semibold text-muted">
              {group.metaName}
              {!group.existingMetaId && (
                <span className="ml-1.5 rounded-full bg-primary/10 px-1.5 py-0.5 font-medium text-primary">
                  new
                </span>
              )}
            </p>
            {group.granulars.map((granular) => (
              <label
                key={granular.key}
                className={`mt-1 flex items-center gap-2 rounded px-1 py-0.5 text-sm ${
                  granular.existingId ? "text-muted" : "cursor-pointer text-ink hover:bg-gray-50"
                }`}
              >
                {granular.existingId ? (
                  <i className="fas fa-check w-4 shrink-0 text-center text-success" />
                ) : (
                  <input
                    type="checkbox"
                    checked={checkedKeys.has(granular.key)}
                    onChange={() => onToggle(granular.key)}
                    className="h-4 w-4 shrink-0 accent-primary"
                  />
                )}
                <span className="min-w-0 flex-1 truncate">{granular.name}</span>
                {granular.existingId && <span className="shrink-0 text-xs">already in course</span>}
              </label>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
