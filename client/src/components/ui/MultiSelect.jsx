import { useEffect, useRef, useState } from "react";

// Checkbox dropdown — the multi-select counterpart to SearchableSelect, for
// applying one action to several options at once.
// options: [{ value, label, hint? }]
export default function MultiSelect({
  value = [],
  onChange,
  options,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  selectAllLabel = "Select all",
  className = "",
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef(null);

  useEffect(() => {
    const handleClick = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const selected = new Set(value);
  const filtered = options.filter((option) =>
    option.label.toLowerCase().includes(search.toLowerCase())
  );
  // A search box for a handful of options is noise; it earns its place once the
  // list is long enough to scroll.
  const searchable = options.length > 7;

  // Selections are always rebuilt from `options`, so the caller receives them in
  // list order however they were clicked.
  const selectionOf = (isSelected) =>
    options.filter((option) => isSelected(option)).map((option) => option.value);

  const toggle = (option) =>
    onChange(
      selectionOf((o) =>
        o.value === option.value ? !selected.has(o.value) : selected.has(o.value)
      )
    );

  // Select all acts on what is on screen, so it stays predictable while a
  // search narrows the list.
  const shown = new Set(filtered.map((option) => option.value));
  const allShownSelected =
    filtered.length > 0 && filtered.every((option) => selected.has(option.value));
  const toggleAll = () =>
    onChange(
      selectionOf((o) =>
        shown.has(o.value) ? !allShownSelected : selected.has(o.value)
      )
    );

  const selectedLabels = options
    .filter((option) => selected.has(option.value))
    .map((option) => option.label);
  const summary =
    selectedLabels.length === 0
      ? placeholder
      : selectedLabels.length <= 3
        ? selectedLabels.join(", ")
        : `${selectedLabels.length} selected`;

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
          setSearch("");
        }}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-left text-sm focus:border-primary focus:outline-none"
      >
        <span className={`truncate ${selectedLabels.length === 0 ? "text-muted" : ""}`}>
          {summary}
        </span>
        <i className="fas fa-chevron-down text-xs text-muted" />
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg">
          {searchable && (
            <div className="border-b border-gray-100 p-2">
              <input
                type="text"
                autoFocus
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={searchPlaceholder}
                className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none"
              />
            </div>
          )}

          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted">No results found</p>
          ) : (
            <>
              <label className="flex cursor-pointer items-center gap-2 border-b border-gray-100 px-3 py-2 text-sm font-medium text-ink hover:bg-primary/5">
                <input
                  type="checkbox"
                  checked={allShownSelected}
                  onChange={toggleAll}
                  className="h-4 w-4 accent-primary"
                />
                <span>{selectAllLabel}</span>
              </label>
              <ul className="max-h-60 overflow-y-auto py-1">
                {filtered.map((option) => (
                  <li key={option.value}>
                    <label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-primary/5">
                      <input
                        type="checkbox"
                        checked={selected.has(option.value)}
                        onChange={() => toggle(option)}
                        className="h-4 w-4 accent-primary"
                      />
                      <span className="truncate">{option.label}</span>
                      {option.hint && (
                        <span className="ml-auto shrink-0 text-xs text-muted">{option.hint}</span>
                      )}
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
