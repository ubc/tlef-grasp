// Formatting and sorting helpers shared by the Analytics tabs.

export const percent = (value) =>
  value === null || value === undefined ? "—" : `${Math.round(value * 100)}%`;

export const headClass = "border-b border-gray-200 px-4 py-3 text-left text-sm font-semibold text-muted";
export const cellClass = "border-b border-gray-100 px-4 py-3 text-sm align-top";

// Lowest share-correct first; rows without enough data go last.
export function comparePValue(a, b) {
  if (a.pValue === null && b.pValue === null) return 0;
  if (a.pValue === null) return 1;
  if (b.pValue === null) return -1;
  return a.pValue - b.pValue;
}

const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

// Why a row is not rated: too few graded responses, or too few different
// students giving them.
export function lowDataNote({ responses, students }, emptyText) {
  if (responses === 0) return emptyText;
  return `Only ${plural(responses, "graded response")} from ${plural(students, "student")}, not enough to rate`;
}

// The rating rule, for the explanations under each table.
export const thresholdRule = ({ minResponses, minStudents }) =>
  `at least ${minResponses} graded responses from at least ${minStudents} different students`;
