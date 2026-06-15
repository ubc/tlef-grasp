import { useEffect, useRef, useState } from "react";

// Searchable dropdown (replaces the legacy jQuery select2 usage).
// options: [{ value, label, icon?, iconColor? }]
export default function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = "Search...",
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

  const selected = options.find((option) => option.value === value);
  const filtered = options.filter((option) =>
    option.label.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          setSearch("");
        }}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-left text-sm focus:border-primary focus:outline-none"
      >
        <span className="flex min-w-0 items-center gap-2 truncate">
          {selected?.icon && (
            <i className={selected.icon} style={{ color: selected.iconColor }} />
          )}
          <span className="truncate">{selected?.label || placeholder}</span>
        </span>
        <i className="fas fa-chevron-down text-xs text-muted" />
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg">
          <div className="border-b border-gray-100 p-2">
            <input
              type="text"
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={placeholder}
              className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none"
            />
          </div>
          <ul className="max-h-60 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-sm text-muted">No results found</li>
            ) : (
              filtered.map((option) => (
                <li key={option.value}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-primary/5 ${
                      option.value === value ? "bg-primary/10 font-medium" : ""
                    }`}
                  >
                    {option.icon && (
                      <i
                        className={`${option.icon} w-4 text-center`}
                        style={{ color: option.iconColor }}
                      />
                    )}
                    <span className="truncate">{option.label}</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
