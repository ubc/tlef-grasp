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

// Item analysis (discrimination, point-biserial, KR-20).

export const formatStat = (value) =>
  value === null || value === undefined ? "—" : value.toFixed(2);

// Worst first, for sorting item tables.
export const FLAG_ORDER = ["miskeyed", "review", "too-hard", "too-easy", "fair", "good"];

export const compareFlag = (a, b) => {
  const rank = (flag) => (flag ? FLAG_ORDER.indexOf(flag) : FLAG_ORDER.length);
  return rank(a) - rank(b);
};

// Lowest discrimination first (point-biserial, else D); unrated rows last.
export function compareDiscrimination(a, b) {
  const value = (stats) => (stats?.enoughData ? stats.pointBiserial ?? stats.discrimination : null);
  const va = value(a);
  const vb = value(b);
  if (va === null && vb === null) return 0;
  if (va === null) return 1;
  if (vb === null) return -1;
  return va - vb;
}

export const RELIABILITY_REASONS = {
  "too-few-students": "Too few students have graded answers in this quiz.",
  "different-questions":
    "Students answered different questions (spaced delivery), so fewer than two questions were answered by everyone.",
  "no-variance": "Every student got the same score on the shared questions.",
};
