// The grade CSV an instructor downloads from Quiz Scores and uploads to Canvas
// themselves (Grades → Import), issue #126. No Canvas API is involved: the file
// only follows the layout Canvas's gradebook importer reads
// (lib/gradebook_importer.rb), so an upload needs no manual matching.
//
// One row per student, one column per quiz holding its percent, then the GRASP
// average. A quiz the student never took is 0 once it has closed for the
// section and blank while it is still open or not yet released; blanks don't
// count towards the average. Optionally, each quiz also gets a "questions
// correct" column ("4 of 5"), for the instructor's own records.

const POINTS_POSSIBLE = 100;

// Canvas skips a column whose Points Possible cell says "read only", but only
// when every row matches a Canvas student; otherwise it imports it as a new
// assignment. So the questions-correct columns are opt-in, and marked.
const READ_ONLY = '(read only)';

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
function quizColumnTitles(names, used = new Set([AVERAGE_TITLE])) {
  return names.map((name) =>
    uniqueTitle(
      `${COLUMN_PREFIX}${String(name || '').replace(/\s+/g, ' ').trim() || 'Untitled quiz'}`
        // "Week 3 (2)" would be read as the title "Week 3" of assignment id 2.
        .replace(/\s\((\d+)\)$/, ' [$1]')
        .replace(CANVAS_TOTAL_COLUMNS, (match) => match.toLowerCase()),
      used
    )
  );
}

// The title, numbered " [2]", " [3]"… if already taken; recorded as taken.
function uniqueTitle(title, used) {
  let unique = title;
  for (let n = 2; used.has(unique); n += 1) unique = `${title} [${n}]`;
  used.add(unique);
  return unique;
}

/**
 * What one quiz cell holds for a student.
 * @param {{score: number}|undefined} record - The student's recorded score, if any
 * @param {'closed'|'open'|'upcoming'} status - The quiz's state for the section
 * @returns {number|null} null for a blank cell
 */
function quizCell(record, status) {
  if (Number.isFinite(record?.score)) return record.score;
  return status === 'closed' ? 0 : null;
}

/**
 * "4 of 5": questions right out of questions served, blank without a score.
 * Not "4/5", which spreadsheet apps read as a date.
 * @param {{correctAnswers: number, totalQuestions: number}|undefined} record
 * @returns {string}
 */
function questionsCorrectCell(record) {
  if (!Number.isFinite(record?.correctAnswers) || !Number.isFinite(record?.totalQuestions)) return '';
  return `${record.correctAnswers} of ${record.totalQuestions}`;
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
 *   section?: string, scores: Map<string, {score: number, correctAnswers: number, totalQuestions: number}>}>} params.students
 *   `scores` maps quiz id to the student's recorded score.
 * @param {boolean} [params.includeQuestionsCorrect] - Add a "(correct)" column after each quiz
 * @returns {string} UTF-8 text with a BOM, CRLF line endings
 */
function buildGradeCsv({ quizzes, students, includeQuestionsCorrect = false }) {
  const used = new Set([AVERAGE_TITLE]);
  const titles = quizColumnTitles(quizzes.map((quiz) => quiz.name), used);
  const correctTitles = includeQuestionsCorrect
    ? titles.map((title) => uniqueTitle(`${title} (correct)`, used))
    : [];

  // Each quiz's columns: its percent, then (optionally) questions correct.
  const header = [];
  const points = [];
  titles.forEach((title, i) => {
    header.push(title);
    points.push(POINTS_POSSIBLE);
    if (includeQuestionsCorrect) {
      header.push(correctTitles[i]);
      points.push(READ_ONLY);
    }
  });
  const lines = [
    [...STUDENT_HEADERS, ...header, AVERAGE_TITLE],
    ['Points Possible', '', '', '', '', '', ...points, POINTS_POSSIBLE],
  ];

  for (const student of students) {
    const records = quizzes.map((quiz) => student.scores?.get(quiz.id));
    const cells = quizzes.map((quiz, i) => quizCell(records[i], quiz.status));
    const quizColumns = [];
    cells.forEach((cell, i) => {
      quizColumns.push(formatScore(cell));
      if (includeQuestionsCorrect) quizColumns.push(questionsCorrectCell(records[i]));
    });
    lines.push([
      guardText(student.name),
      student.canvasUserId || '',
      // GRASP doesn't hold UBC's SIS user id; Canvas matches on the next column.
      '',
      student.loginId || student.puid || '',
      student.puid || '',
      guardText(student.section),
      ...quizColumns,
      formatScore(averageOf(cells)),
    ]);
  }

  return `\uFEFF${lines.map((line) => line.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

module.exports = {
  AVERAGE_TITLE,
  COLUMN_PREFIX,
  POINTS_POSSIBLE,
  READ_ONLY,
  STUDENT_HEADERS,
  averageOf,
  buildGradeCsv,
  questionsCorrectCell,
  quizCell,
  quizColumnTitles,
};
