import { useEffect, useState } from "react";
import {
  NARROW_SIBLINGS,
  WIDE_SIBLINGS,
  visiblePages,
} from "./paginationUtils";

// Below Tailwind's `sm` breakpoint (40rem) there is not room for the full
// window of page buttons, so the run narrows from 7 numbers to 5.
const NARROW_QUERY = "(max-width: 639.98px)";

function useIsNarrow() {
  const [isNarrow, setIsNarrow] = useState(
    () => window.matchMedia(NARROW_QUERY).matches
  );

  useEffect(() => {
    const query = window.matchMedia(NARROW_QUERY);
    const sync = (event) => setIsNarrow(event.matches);
    setIsNarrow(query.matches);
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  return isNarrow;
}

// Numbered pagination with ellipsis collapsing (1 ... 3 4 5 6 7 ... 20),
// narrowing to 1 ... 4 5 6 ... 20 on phone-width screens.
export default function Pagination({
  currentPage,
  totalPages,
  onPageChange,
  ariaLabel = "Pagination",
}) {
  const isNarrow = useIsNarrow();

  if (totalPages <= 1) return null;

  const pages = visiblePages(
    currentPage,
    totalPages,
    isNarrow ? NARROW_SIBLINGS : WIDE_SIBLINGS
  );

  return (
    <nav className="flex items-center gap-1" aria-label={ariaLabel}>
      <button
        type="button"
        disabled={currentPage === 1}
        onClick={() => onPageChange(currentPage - 1)}
        aria-label="Previous page"
        className="rounded-lg border border-gray-300 px-3 py-1.5 transition-colors hover:bg-gray-50 disabled:opacity-40"
      >
        <i className="fas fa-chevron-left" aria-hidden="true" />
      </button>
      {pages.map((p, index, arr) => (
        <span key={p} className="flex items-center">
          {index > 0 && arr[index - 1] !== p - 1 && (
            <span className="px-1" aria-hidden="true">
              ...
            </span>
          )}
          <button
            type="button"
            onClick={() => onPageChange(p)}
            aria-label={`Page ${p}`}
            aria-current={p === currentPage ? "page" : undefined}
            className={`rounded-lg border px-3 py-1.5 transition-colors ${
              p === currentPage
                ? "border-primary bg-primary text-white"
                : "border-gray-300 hover:bg-gray-50"
            }`}
          >
            {p}
          </button>
        </span>
      ))}
      <button
        type="button"
        disabled={currentPage === totalPages}
        onClick={() => onPageChange(currentPage + 1)}
        aria-label="Next page"
        className="rounded-lg border border-gray-300 px-3 py-1.5 transition-colors hover:bg-gray-50 disabled:opacity-40"
      >
        <i className="fas fa-chevron-right" aria-hidden="true" />
      </button>
    </nav>
  );
}
