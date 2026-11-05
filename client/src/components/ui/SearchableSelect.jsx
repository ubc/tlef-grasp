import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState } from "react";

const GAP = 4;
const SCREEN_MARGIN = 8;
const PANEL_MAX_HEIGHT = 320;

const FIELD_PADDING = {
  sm: "px-3 py-2",
  lg: "px-3 py-3",
};

// Searchable dropdown (replaces the legacy jQuery select2 usage).
// options: [{ value, label, icon?, iconColor?, group? }]
// The list is position: fixed so a scrolling parent (e.g. a modal body)
// cannot clip it.
export default function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = "Search...",
  searchPlaceholder = placeholder,
  ariaLabel,
  labelId,
  size = "sm",
  className = "",
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState(null);
  const containerRef = useRef(null);
  const triggerRef = useRef(null);
  const baseId = useId();
  const listId = `${baseId}-list`;
  const valueId = `${baseId}-value`;
  const nameId = labelId || (ariaLabel ? `${baseId}-label` : null);
  const optionId = (index) => `${baseId}-option-${index}`;

  const selected = options.find((option) => option.value === value);
  const term = search.trim().toLowerCase();
  const filtered = term
    ? options.filter((option) =>
        `${option.label} ${option.group || ""}`.toLowerCase().includes(term)
      )
    : options;

  const close = ({ refocus = false } = {}) => {
    setOpen(false);
    setPosition(null);
    if (refocus) triggerRef.current?.focus();
  };

  const openList = () => {
    setSearch("");
    setActiveIndex(Math.max(0, options.findIndex((option) => option.value === value)));
    setOpen(true);
  };

  const choose = (option) => {
    onChange(option.value);
    close({ refocus: true });
  };

  useEffect(() => {
    if (!open) return undefined;
    const handleMouseDown = (event) => {
      if (containerRef.current?.contains(event.target)) return;
      setOpen(false);
      setPosition(null);
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [open]);

  // Opens below the field, or above it when there is more room there.
  useLayoutEffect(() => {
    if (!open) return undefined;
    const place = () => {
      const rect = triggerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom - GAP - SCREEN_MARGIN;
      const spaceAbove = rect.top - GAP - SCREEN_MARGIN;
      const above = spaceBelow < PANEL_MAX_HEIGHT && spaceAbove > spaceBelow;
      setPosition({
        left: rect.left,
        width: rect.width,
        maxHeight: Math.min(PANEL_MAX_HEIGHT, above ? spaceAbove : spaceBelow),
        ...(above
          ? { bottom: window.innerHeight - rect.top + GAP }
          : { top: rect.bottom + GAP }),
      });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    document
      .getElementById(`${baseId}-option-${activeIndex}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex, baseId]);

  const handleTriggerKeyDown = (event) => {
    if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      openList();
    }
  };

  const handleSearchKeyDown = (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, filtered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (filtered[activeIndex]) choose(filtered[activeIndex]);
    } else if (event.key === "Escape") {
      // Close only the list; a dialog underneath stays open.
      event.preventDefault();
      event.stopPropagation();
      close({ refocus: true });
    } else if (event.key === "Tab") {
      close();
    }
  };

  const sections = [];
  filtered.forEach((option, index) => {
    const group = option.group || "";
    const last = sections[sections.length - 1];
    if (last && last.group === group) last.items.push({ option, index });
    else sections.push({ group, items: [{ option, index }] });
  });

  const renderOption = ({ option, index }) => {
    const isSelected = option.value === value;
    const isActive = index === activeIndex;
    return (
      <div
        key={option.value}
        id={optionId(index)}
        role="option"
        aria-selected={isSelected}
        onMouseMove={() => setActiveIndex(index)}
        // Keep focus in the search box so the list stays open until a choice.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => choose(option)}
        className={`flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
          isActive ? "bg-primary/5" : isSelected ? "bg-primary/10" : ""
        } ${isSelected ? "font-medium" : ""}`}
      >
        {option.icon && (
          <i className={`${option.icon} w-4 text-center`} style={{ color: option.iconColor }} />
        )}
        <span className="min-w-0 break-words">{option.label}</span>
      </div>
    );
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {ariaLabel && !labelId && (
        <span id={nameId} className="sr-only">
          {ariaLabel}
        </span>
      )}
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-labelledby={nameId ? `${nameId} ${valueId}` : undefined}
        title={selected?.label}
        onClick={() => (open ? close() : openList())}
        onKeyDown={handleTriggerKeyDown}
        className={`flex w-full items-center justify-between gap-2 rounded-lg border border-gray-300 bg-white text-left text-sm focus:border-primary focus:outline-none ${
          FIELD_PADDING[size] || FIELD_PADDING.sm
        }`}
      >
        <span className="flex min-w-0 items-center gap-2 truncate">
          {selected?.icon && (
            <i className={selected.icon} style={{ color: selected.iconColor }} />
          )}
          <span id={valueId} className="truncate">
            {selected?.label || placeholder}
          </span>
        </span>
        <i className="fas fa-chevron-down text-xs text-muted" />
      </button>

      {open && position && (
        <div
          className="fixed z-50 flex flex-col rounded-lg border border-gray-200 bg-white shadow-lg"
          style={position}
        >
          <div className="border-b border-gray-100 p-2">
            <input
              type="text"
              role="combobox"
              aria-label={searchPlaceholder}
              aria-expanded="true"
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={filtered[activeIndex] ? optionId(activeIndex) : undefined}
              autoFocus
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={handleSearchKeyDown}
              placeholder={searchPlaceholder}
              className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none"
            />
          </div>
          <div
            id={listId}
            role="listbox"
            aria-labelledby={nameId || undefined}
            className="max-h-60 min-h-0 overflow-y-auto py-1"
          >
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-sm text-muted">No results found</div>
            ) : (
              sections.map((section) => {
                const key = section.items[0].index;
                if (!section.group) {
                  return <Fragment key={`items-${key}`}>{section.items.map(renderOption)}</Fragment>;
                }
                return (
                  <div key={`group-${key}`} role="group" aria-labelledby={`${baseId}-group-${key}`}>
                    <div
                      id={`${baseId}-group-${key}`}
                      className="px-3 pt-2 pb-1 text-sm font-bold text-muted"
                    >
                      {section.group}
                    </div>
                    {section.items.map(renderOption)}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
