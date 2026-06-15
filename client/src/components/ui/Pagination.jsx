// Numbered pagination with ellipsis collapsing (1 ... 4 5 6 ... 20).
export default function Pagination({ currentPage, totalPages, onPageChange }) {
  if (totalPages <= 1) return null;

  const pages = Array.from({ length: totalPages }, (_, i) => i + 1).filter(
    (p) =>
      totalPages <= 7 ||
      p === 1 ||
      p === totalPages ||
      Math.abs(p - currentPage) <= 2
  );

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        disabled={currentPage === 1}
        onClick={() => onPageChange(currentPage - 1)}
        className="rounded-lg border border-gray-300 px-3 py-1.5 transition-colors hover:bg-gray-50 disabled:opacity-40"
      >
        <i className="fas fa-chevron-left" />
      </button>
      {pages.map((p, index, arr) => (
        <span key={p} className="flex items-center">
          {index > 0 && arr[index - 1] !== p - 1 && <span className="px-1">...</span>}
          <button
            type="button"
            onClick={() => onPageChange(p)}
            className={`rounded-lg px-3 py-1.5 transition-colors ${
              p === currentPage
                ? "bg-primary text-white"
                : "border border-gray-300 hover:bg-gray-50"
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
        className="rounded-lg border border-gray-300 px-3 py-1.5 transition-colors hover:bg-gray-50 disabled:opacity-40"
      >
        <i className="fas fa-chevron-right" />
      </button>
    </div>
  );
}
