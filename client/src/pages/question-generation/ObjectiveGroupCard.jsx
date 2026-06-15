import { BLOOM_LEVELS } from "../../lib/constants";
import AutoGrowTextarea from "./AutoGrowTextarea";

function GranularItemRow({
  item,
  showValidation,
  onToggleSelected,
  onCommitText,
  onToggleBloom,
  onChangeCount,
  onDelete,
}) {
  const showBloomValidation =
    showValidation && item.mode === "manual" && item.bloom.length === 0;

  return (
    <div
      className={`flex gap-3 rounded-xl border border-gray-100 p-3 ${
        item.level === 2 ? "ml-8" : ""
      }`}
    >
      <div className="flex flex-col items-center gap-2 pt-1">
        <input
          type="checkbox"
          checked={!!item.selected}
          onChange={onToggleSelected}
          className="h-4 w-4 accent-primary"
        />
        <button
          type="button"
          title="Delete granular objective from page"
          onClick={onDelete}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-danger/10 hover:text-danger"
        >
          <i className="fas fa-trash-alt text-sm" />
        </button>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <AutoGrowTextarea
              value={item.text}
              placeholder="Enter granular objective"
              onCommit={onCommitText}
              className="text-sm text-ink"
            />
          </div>
          {item.level === 2 && (
            <span className="shrink-0 rounded-full bg-purple-100 px-2 py-0.5 text-xs font-semibold text-purple-700">
              Sub-LO
            </span>
          )}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1.5">
            {BLOOM_LEVELS.map((level) => {
              const isSelected = item.bloom.includes(level);
              return (
                <button
                  key={level}
                  type="button"
                  aria-checked={isSelected}
                  disabled={item.mode === "auto"}
                  onClick={() => onToggleBloom(level)}
                  className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                    isSelected
                      ? "bg-primary text-white"
                      : "bg-gray-100 text-muted hover:bg-gray-200"
                  } disabled:opacity-50`}
                >
                  {level}
                </button>
              );
            })}
          </div>
        </div>

        {showBloomValidation && (
          <div className="mt-2 flex items-center gap-1.5 text-xs text-danger">
            <i className="fas fa-exclamation-circle" />
            <span>Please select at least one Bloom's Taxonomy level.</span>
          </div>
        )}
      </div>

      {/* Count stepper */}
      <div className="flex shrink-0 items-center gap-1.5 self-start pt-1">
        <button
          type="button"
          disabled={item.count <= Math.max(2, item.bloom.length)}
          onClick={() => onChangeCount(-1)}
          className="flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 text-muted transition-colors hover:bg-gray-50 disabled:opacity-30"
        >
          <i className="fas fa-minus text-xs" />
        </button>
        <span className="w-6 text-center text-sm font-semibold text-ink">
          {item.count}
        </span>
        <button
          type="button"
          disabled={item.count >= 9}
          onClick={() => onChangeCount(1)}
          className="flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 text-muted transition-colors hover:bg-gray-50 disabled:opacity-30"
        >
          <i className="fas fa-plus text-xs" />
        </button>
      </div>
    </div>
  );
}

// One meta learning objective with its editable granular objectives.
export default function ObjectiveGroupCard({
  group,
  showValidation,
  onUpdateGroup,
  onCommitTitle,
  onCommitItemText,
  onToggleBloom,
  onChangeCount,
  onDeleteItem,
  onAddGranular,
  onRequestDelete,
  onRequestGranularize,
}) {
  const totalCount = group.items.reduce((sum, item) => sum + (item.count || 0), 0);
  const selectedCount = group.items.filter((i) => i.selected).length;
  const allSelected = group.items.length > 0 && group.items.every((i) => i.selected);

  return (
    <div className="rounded-2xl bg-white shadow-sm">
      {/* Group header */}
      <div className="flex items-center gap-2 border-b border-gray-100 p-4">
        <button
          type="button"
          title="Delete learning objective from page"
          aria-label={`Delete ${group.title}`}
          onClick={onRequestDelete}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-danger/10 hover:text-danger"
        >
          <i className="fas fa-trash-alt" />
        </button>
        <div className="min-w-0 flex-1">
          <AutoGrowTextarea
            value={group.title}
            onCommit={onCommitTitle}
            className="text-lg font-semibold text-ink"
          />
        </div>
        <button
          type="button"
          onClick={() => onUpdateGroup((g) => ({ ...g, isOpen: !g.isOpen }))}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-gray-100"
          aria-label="Toggle group"
        >
          <i
            className={`fas fa-chevron-down transition-transform ${
              group.isOpen ? "" : "-rotate-90"
            }`}
          />
        </button>
      </div>

      {group.isOpen && (
        <div className="p-4">
          {group.items.length === 0 && (
            <p className="mb-4 text-sm text-muted">No granular objectives yet</p>
          )}

          {/* Selection toolbar */}
          {group.items.length > 0 && selectedCount > 0 && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-page px-4 py-2.5">
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = selectedCount > 0 && !allSelected;
                    }}
                    onChange={(event) =>
                      onUpdateGroup((g) => ({
                        ...g,
                        items: g.items.map((i) => ({
                          ...i,
                          selected: event.target.checked,
                        })),
                      }))
                    }
                    className="h-4 w-4 accent-primary"
                  />
                  <span>Select all in this meta</span>
                </label>
                <span className="text-sm text-muted">{selectedCount} selected</span>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onRequestGranularize}
                  className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary-dark"
                >
                  Make more granular
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onUpdateGroup((g) => ({
                      ...g,
                      items: g.items.filter((i) => !i.selected),
                    }))
                  }
                  className="rounded-lg bg-danger px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-danger/85"
                >
                  Delete selected
                </button>
              </div>
            </div>
          )}

          {/* Items */}
          <div className="space-y-3">
            {group.items.map((item) => (
              <GranularItemRow
                key={item.id}
                item={item}
                showValidation={showValidation}
                onToggleSelected={() =>
                  onUpdateGroup((g) => ({
                    ...g,
                    items: g.items.map((i) =>
                      i.id === item.id ? { ...i, selected: !i.selected } : i
                    ),
                  }))
                }
                onCommitText={(value) => onCommitItemText(item, value)}
                onToggleBloom={(level) => onToggleBloom(item, level)}
                onChangeCount={(delta) => onChangeCount(item, delta)}
                onDelete={() => onDeleteItem(item)}
              />
            ))}
          </div>

          {/* Footer */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={onAddGranular}
              className="inline-flex items-center gap-1.5 rounded-md border border-primary bg-white px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/5"
            >
              <i className="fas fa-plus" /> Add Granular Objective
            </button>
            <span className="text-xs text-muted">
              Total questions: {totalCount}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
