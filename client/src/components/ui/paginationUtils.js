// Which page numbers a pagination control shows, given how many siblings sit
// on either side of the current page. Pulled out of Pagination.jsx so it can be
// unit tested without a DOM.

// Wide screens fit 1 ... 3 4 5 6 7 ... 20 (five numbers around the current
// page); below Tailwind's `sm` breakpoint only 1 ... 4 5 6 ... 20 fits on one
// line, so the middle run drops to three.
export const WIDE_SIBLINGS = 2; // two pages on each side of the current page
export const NARROW_SIBLINGS = 1; // one page on each side of the current page

/**
 * @param {number} currentPage 1-based page currently shown.
 * @param {number} totalPages Total number of pages.
 * @param {number} siblings Pages kept on either side of the current page.
 * @returns {number[]} Ascending page numbers to render. Gaps between
 *   consecutive entries are where the caller draws an ellipsis.
 */
export function visiblePages(currentPage, totalPages, siblings) {
  // First page, last page, and the window around the current one. Once that
  // adds up to the whole range there is nothing to collapse, so show it all.
  const maxNumbers = siblings * 2 + 3;

  return Array.from({ length: totalPages }, (_, i) => i + 1).filter(
    (p) =>
      totalPages <= maxNumbers ||
      p === 1 ||
      p === totalPages ||
      Math.abs(p - currentPage) <= siblings
  );
}
