// The grade CSV an instructor downloads from Quiz Scores and uploads to Canvas
// themselves (Grades → Import), issue #126. No Canvas API is involved: the file
// only follows the layout Canvas's gradebook importer reads
// (lib/gradebook_importer.rb), so an upload needs no manual matching.
//
// One row per student, one column per quiz holding its percent, then the GRASP
// average. A quiz the student never took is 0 once it has closed for the
// section and blank while it is still open or not yet released; blanks don't
// count towards the average.

const POINTS_POSSIBLE = 100;

// Canvas matches a column to an existing assignment by its exact title, so a
// GRASP quiz called "Quiz 1" would write into a Canvas assignment of the same
// name (common once quizzes were imported from Canvas). Every GRASP column is
// prefixed so it only ever matches the column an earlier upload created.
const COLUMN_PREFIX = 'GRASP: ';
const AVERAGE_TITLE = `${COLUMN_PREFIX}Average`;

// Student columns, in the order Canvas expects: with "SIS User ID" and
// "SIS Login ID" present, "Integration ID" may follow, then "Section" ends the
// student block. Canvas matches a row by ID (Canvas user id), then SIS User ID,
// then SIS Login ID, then by name; Integration ID is read but not matched on.
const STUDENT_HEADERS = ['Student', 'ID', 'SIS User ID', 'SIS Login ID', 'Integration ID', 'Section'];

// Canvas drops any column whose title contains one of these (case-sensitive,
// anywhere in the title) as a computed total, not an assignment.
const CANVAS_TOTAL_COLUMNS = /(Current|Final) (Score|Points|Grade)|Override (Score|Grade|Status)/g;

/**
 * Column titles for the quizzes, in order, each unique and safe for Canvas's
 * importer. The average's title is reserved first so a quiz named "Average"
 * can't take it.
 * @param {string[]} names - Quiz names
 * @returns {string[]}
 */
function quizColumnTitles(names) {
  const used = new Set([AVERAGE_TITLE]);
  return names.map((name) => {
    let title = `${COLUMN_PREFIX}${String(name || '').replace(/\s+/g, ' ').trim() || 'Untitled quiz'}`
      // "Week 3 (2)" would be read as the title "Week 3" of assignment id 2.
      .replace(/\s\((\d+)\)$/, ' [$1]')
      .replace(CANVAS_TOTAL_COLUMNS, (match) => match.toLowerCase());
    if (used.has(title)) {
      let n = 2;
      while (used.has(`${title} [${n}]`)) n += 1;
      title = `${title} [${n}]`;
    }
    used.add(title);
    return title;
  });
}

/**
 * What one quiz cell holds for a student.
 * @param {number|null|undefined} score - The student's recorded percent, if any
 * @param {'closed'|'open'|'upcoming'} status - The quiz's state for the section
 * @returns {number|null} null for a blank cell
 */
function quizCell(score, status) {
  if (typeof score === 'number' && Number.isFinite(score)) return score;
  return status === 'closed' ? 0 : null;
}

/**
 * Mean of the non-blank cells, to two decimals; null when every cell is blank.
 * @param {Array<number|null>} cells
 * @returns {number|null}
 */
function averageOf(cells) {
  const counted = cells.filter((cell) => typeof cell === 'number');
  if (counted.length === 0) return null;
  const mean = counted.reduce((sum, cell) => sum + cell, 0) / counted.length;
  return Math.round(mean * 100) / 100;
}

// Spreadsheet apps run a cell that starts with one of these as a formula.
function guardText(value) {
  const text = String(value ?? '').replace(/[\r\n]+/g, ' ');
  return /^[=+\-@\t]/.test(text) ? `'${text}` : text;
}

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function formatScore(value) {
  return value === null ? '' : String(Math.round(value * 100) / 100);
}

/**
 * Build the CSV.
 * @param {Object} params
 * @param {Array<{id: string, name: string, status: 'closed'|'open'|'upcoming'}>} params.quizzes - In column order
 * @param {Array<{name: string, canvasUserId?: string, loginId?: string, puid?: string,
 *   section?: string, scores: Map<string, number>|Object}>} params.students
 *   `scores` maps quiz id to the recorded percent.
 * @returns {string} UTF-8 text with a BOM, CRLF line endings
 */
function buildGradeCsv({ quizzes, students }) {
  const titles = quizColumnTitles(quizzes.map((quiz) => quiz.name));
  const lines = [
    [...STUDENT_HEADERS, ...titles, AVERAGE_TITLE],
    ['Points Possible', '', '', '', '', '', ...quizzes.map(() => POINTS_POSSIBLE), POINTS_POSSIBLE],
  ];

  for (const student of students) {
    const scoreOf = (quizId) =>
      student.scores instanceof Map ? student.scores.get(quizId) : student.scores?.[quizId];
    const cells = quizzes.map((quiz) => quizCell(scoreOf(quiz.id), quiz.status));
    lines.push([
      guardText(student.name),
      student.canvasUserId || '',
      // GRASP doesn't hold UBC's SIS user id; Canvas matches on the next column.
      '',
      student.loginId || student.puid || '',
      student.puid || '',
      guardText(student.section),
      ...cells.map(formatScore),
      formatScore(averageOf(cells)),
    ]);
  }

  return `﻿${lines.map((line) => line.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

module.exports = {
  AVERAGE_TITLE,
  COLUMN_PREFIX,
  POINTS_POSSIBLE,
  STUDENT_HEADERS,
  averageOf,
  buildGradeCsv,
  quizCell,
  quizColumnTitles,
};
