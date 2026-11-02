// The grade CSV (issue #126): Canvas's gradebook-import layout, missed quizzes,
// the average, and column titles Canvas can't misread.
const {
  AVERAGE_TITLE,
  averageOf,
  buildGradeCsv,
  questionsCorrectCell,
  quizCell,
  quizColumnTitles,
} = require('../../src/utils/grade-csv');

// quiz id -> [percent, correct, total]
const scores = (byQuiz = {}) =>
  new Map(
    Object.entries(byQuiz).map(([quizId, [score, correctAnswers, totalQuestions]]) => [
      quizId,
      { score, correctAnswers, totalQuestions },
    ])
  );

function rowsOf(csv) {
  expect(csv.startsWith('﻿')).toBe(true);
  expect(csv.endsWith('\r\n')).toBe(true);
  return csv.slice(1, -2).split('\r\n');
}

const QUIZZES = [
  { id: 'q1', name: 'Quiz 1', status: 'closed' },
  { id: 'q2', name: 'Quiz 2', status: 'open' },
  { id: 'q3', name: 'Quiz 3', status: 'upcoming' },
];

describe('buildGradeCsv', () => {
  it('writes the student columns and a Points Possible row in the order Canvas reads', () => {
    const [header, points] = rowsOf(buildGradeCsv({ quizzes: QUIZZES, students: [] }));
    expect(header).toBe(
      'Student,ID,SIS User ID,SIS Login ID,Integration ID,Section,' +
        'GRASP: Quiz 1,GRASP: Quiz 2,GRASP: Quiz 3,GRASP: Average'
    );
    expect(points).toBe('Points Possible,,,,,,100,100,100,100');
  });

  it('puts the PUID in Integration ID, and in SIS Login ID when Canvas gave no login', () => {
    const [, , synced, unsynced] = rowsOf(
      buildGradeCsv({
        quizzes: QUIZZES.slice(0, 1),
        students: [
          { name: 'Ada Lovelace', canvasUserId: '77', loginId: 'ADA123', puid: 'PUID0001', section: '101', scores: scores() },
          { name: 'Alan Turing', puid: 'PUID0002', section: '101', scores: scores() },
        ],
      })
    );
    expect(synced).toBe('Ada Lovelace,77,,ADA123,PUID0001,101,0,0');
    expect(unsynced).toBe('Alan Turing,,,PUID0002,PUID0002,101,0,0');
  });

  it('scores a missed quiz 0 once closed, blank while open or upcoming, and averages the rest', () => {
    const [, , taker, absent] = rowsOf(
      buildGradeCsv({
        quizzes: QUIZZES,
        students: [
          { name: 'Taker', puid: 'P1', section: '101', scores: scores({ q1: [80, 4, 5], q2: [95, 19, 20] }) },
          { name: 'Absent', puid: 'P2', section: '101', scores: scores() },
        ],
      })
    );
    expect(taker).toBe('Taker,,,P1,P1,101,80,95,,87.5');
    expect(absent).toBe('Absent,,,P2,P2,101,0,,,0');
  });

  it('leaves the average blank when nothing counts yet', () => {
    const [, , row] = rowsOf(
      buildGradeCsv({
        quizzes: [QUIZZES[1]],
        students: [{ name: 'New', puid: 'P3', section: '101', scores: scores() }],
      })
    );
    expect(row).toBe('New,,,P3,P3,101,,');
  });

  it('quotes commas and quotes, and keeps names from running as spreadsheet formulas', () => {
    const [header, , row] = rowsOf(
      buildGradeCsv({
        quizzes: [{ id: 'q1', name: 'Acids, "bases"', status: 'closed' }],
        students: [{ name: '=HYPERLINK("x")', puid: 'P4', section: '101', scores: scores({ q1: [50, 1, 2] }) }],
      })
    );
    expect(header).toContain('"GRASP: Acids, ""bases"""');
    expect(row.startsWith(`"'=HYPERLINK(""x"")",`)).toBe(true);
  });
});

describe('buildGradeCsv with questions correct', () => {
  const rows = () =>
    rowsOf(
      buildGradeCsv({
        quizzes: QUIZZES.slice(0, 2),
        students: [
          { name: 'Taker', puid: 'P1', section: '101', scores: scores({ q1: [80, 4, 5] }) },
          { name: 'Absent', puid: 'P2', section: '101', scores: scores() },
        ],
        includeQuestionsCorrect: true,
      })
    );

  it('puts a read-only "(correct)" column after each quiz', () => {
    const [header, points] = rows();
    expect(header).toBe(
      'Student,ID,SIS User ID,SIS Login ID,Integration ID,Section,' +
        'GRASP: Quiz 1,GRASP: Quiz 1 (correct),GRASP: Quiz 2,GRASP: Quiz 2 (correct),GRASP: Average'
    );
    expect(points).toBe('Points Possible,,,,,,100,(read only),100,(read only),100');
  });

  it('writes "4 of 5" for a quiz taken and leaves the rest blank, without changing the average', () => {
    const [, , taker, absent] = rows();
    expect(taker).toBe('Taker,,,P1,P1,101,80,4 of 5,,,80');
    expect(absent).toBe('Absent,,,P2,P2,101,0,,,,0');
  });

  it('numbers a "(correct)" title another quiz already uses', () => {
    const [header] = rowsOf(
      buildGradeCsv({
        quizzes: [
          { id: 'a', name: 'Quiz 1 (correct)', status: 'closed' },
          { id: 'b', name: 'Quiz 1', status: 'closed' },
        ],
        students: [],
        includeQuestionsCorrect: true,
      })
    );
    expect(header.split(',').slice(6)).toEqual([
      'GRASP: Quiz 1 (correct)',
      'GRASP: Quiz 1 (correct) (correct)',
      'GRASP: Quiz 1',
      'GRASP: Quiz 1 (correct) [2]',
      'GRASP: Average',
    ]);
  });
});

describe('quizColumnTitles', () => {
  it('prefixes every quiz so it never matches a Canvas assignment of the same name', () => {
    expect(quizColumnTitles(['Quiz 1'])).toEqual(['GRASP: Quiz 1']);
  });

  it("doesn't let a trailing (number) read as a Canvas assignment id", () => {
    expect(quizColumnTitles(['Week 3 (2)'])).toEqual(['GRASP: Week 3 [2]']);
  });

  it('numbers repeated names and never takes the average column', () => {
    expect(quizColumnTitles(['Quiz', 'Quiz', 'Average', 'Quiz'])).toEqual([
      'GRASP: Quiz',
      'GRASP: Quiz [2]',
      `${AVERAGE_TITLE} [2]`,
      'GRASP: Quiz [3]',
    ]);
  });

  it('lower-cases words Canvas would drop as a computed total column', () => {
    expect(quizColumnTitles(['Final Score practice', 'Current Grade check'])).toEqual([
      'GRASP: final score practice',
      'GRASP: current grade check',
    ]);
  });

  it('flattens line breaks and names an unnamed quiz', () => {
    expect(quizColumnTitles(['Line\none', '  '])).toEqual(['GRASP: Line one', 'GRASP: Untitled quiz']);
  });
});

describe('quizCell, questionsCorrectCell and averageOf', () => {
  it('keeps a recorded score whatever the state, including 0', () => {
    expect(quizCell({ score: 0 }, 'upcoming')).toBe(0);
    expect(quizCell({ score: 72 }, 'open')).toBe(72);
    expect(quizCell(undefined, 'closed')).toBe(0);
    expect(quizCell(undefined, 'open')).toBeNull();
  });

  it('writes questions correct as "n of m", never as a date-like "n/m"', () => {
    expect(questionsCorrectCell({ correctAnswers: 0, totalQuestions: 7 })).toBe('0 of 7');
    expect(questionsCorrectCell({ correctAnswers: NaN, totalQuestions: 7 })).toBe('');
    expect(questionsCorrectCell(undefined)).toBe('');
  });

  it('rounds the mean to two decimals', () => {
    expect(averageOf([100, 0, 0])).toBe(33.33);
    expect(averageOf([null, null])).toBeNull();
  });
});
