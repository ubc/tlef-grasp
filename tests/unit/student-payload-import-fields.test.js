// Canvas import provenance (`source`), conversion warnings
// (`importWarnings`) and the Canvas items an import linked to a quiz
// (`importLinkedItems`) are instructor-only (#140). Every payload a student
// can fetch must leave them out, for every question type: the graded quiz
// (GET /api/student/quizzes/:id/questions), the quiz question list whenever
// answers are withheld (GET /api/quiz/:id/questions), and the quiz documents
// behind the student quiz list, overview and quiz page. Instructors keep them.

const express = require('express');
const request = require('supertest');
const { ObjectId } = require('mongodb');

jest.mock('../../src/services/quiz', () => ({
  getQuizById: jest.fn(),
  getQuizQuestions: jest.fn(),
  getQuizQuestionsForStudent: jest.fn(),
  getQuizzesByCourse: jest.fn(),
  getApprovedQuestionCountsForQuizzes: jest.fn(),
}));
jest.mock('../../src/services/quiz-schedule', () => ({
  getStudentSectionObjectIds: jest.fn(),
  getSchedulesForQuiz: jest.fn(),
  getSchedulesForQuizzes: jest.fn(),
  resolveWindow: jest.fn(),
}));
jest.mock('../../src/services/quiz-session', () => ({
  getOrCreateSession: jest.fn(),
  recordQuestionCount: jest.fn(),
  getUnsubmittedQuizIds: jest.fn(),
}));
jest.mock('../../src/services/user-course', () => ({
  getStudentCourses: jest.fn(),
  isUserInCourse: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../src/services/course', () => ({
  getCourseById: jest.fn(),
}));
jest.mock('../../src/services/achievement', () => ({
  awardQuizAchievements: jest.fn(),
}));
jest.mock('../../src/services/database', () => ({
  connect: jest.fn(),
}));
// Loading the quiz router would otherwise start the LLM client.
jest.mock('../../src/services/answer-grading', () => ({}));
jest.mock('../../src/utils/auth', () => ({
  ...jest.requireActual('../../src/utils/auth'),
  isFaculty: jest.fn().mockResolvedValue(false),
}));
jest.mock('../../src/utils/course-access', () => ({
  hasStaffAccessInCourse: jest.fn(),
}));
jest.mock('../../src/middleware/auth', () => ({
  requireRole: () => (_req, _res, next) => next(),
  requirePageRole: () => (_req, _res, next) => next(),
}));

const quizService = require('../../src/services/quiz');
const quizScheduleService = require('../../src/services/quiz-schedule');
const quizSessionService = require('../../src/services/quiz-session');
const { getCourseById } = require('../../src/services/course');
const databaseService = require('../../src/services/database');
const { hasStaffAccessInCourse } = require('../../src/utils/course-access');
const studentRouter = require('../../src/routes/student');
const quizRouter = require('../../src/routes/quiz');

const USER_ID = new ObjectId().toString();
const COURSE_ID = new ObjectId();
const QUIZ_ID = new ObjectId().toString();

// Distinctive values, so a leak anywhere in a response body shows up.
const SOURCE = {
  kind: 'canvas-classic',
  quizIdent: 'g0leakcheckquiz000000000000000a1',
  itemIdent: 'g0leakcheckitem000000000000000b2',
  slotIdent: 'g0leakcheckslot000000000000000c3',
};
const WARNINGS = ['Leak check: an image could not be downloaded from Canvas.'];
const LINKED_ITEMS = ['g0leakchecklinked00000000000000d4', 'g0leakchecklinked00000000000000e5'];
const imported = { source: SOURCE, importWarnings: WARNINGS };

const optionImage = {
  fileId: new ObjectId().toString(),
  filename: 'canvas-image-1.png',
  mimeType: 'image/png',
  size: 1234,
  caption: '',
};

// One imported question of every type the student views handle, as stored.
const importedQuestions = () => [
  {
    _id: new ObjectId(),
    questionType: 'multiple-choice',
    title: 'Which gas does the reaction release?',
    stem: 'Select the best answer:',
    options: {
      A: { text: 'Oxygen', feedback: 'No' },
      B: { text: 'Carbon dioxide', feedback: 'Yes' },
      C: { text: '', feedback: 'No', image: optionImage },
    },
    correctAnswer: 'B',
    bloom: 'Understand',
    ...imported,
  },
  {
    _id: new ObjectId(),
    questionType: 'fill-in-the-blank',
    title: 'Thermochemistry quiz – Q02',
    stem: 'The SI unit of energy is the _________',
    correctAnswer: 'joule',
    acceptableAnswers: ['joule', 'J'],
    bloom: 'Understand',
    ...imported,
  },
  {
    _id: new ObjectId(),
    questionType: 'open-ended',
    title: 'Entropy',
    stem: 'Explain why entropy increases when ice melts.',
    openEndedSampleAnswer: 'The molecules gain freedom of motion.',
    openEndedGradingCriteria: 'Mentions molecular freedom.',
    bloom: 'Understand',
    ...imported,
  },
  {
    _id: new ObjectId(),
    questionType: 'calculation',
    title: 'Energy stored in the test cell',
    stem: 'Find the energy stored in the test cell, in kJ.',
    calculationFormula: '-123.4',
    calculationVariables: [],
    calculationAnswerDecimals: 1,
    calculationTolerance: { mode: 'absolute', value: 0.2 },
    bloom: 'Understand',
    ...imported,
  },
  {
    // A calculation that cannot be built takes the load-error branch.
    _id: new ObjectId(),
    questionType: 'calculation',
    title: 'Broken calculation',
    stem: 'Calculate the yield.',
    calculationFormula: '',
    calculationVariables: [],
    bloom: 'Understand',
    ...imported,
  },
];

const TYPES_SENT = [
  'multiple-choice',
  'fill-in-the-blank',
  'open-ended',
  'calculation',
  'calculation',
];

// [questionType, has source, has importWarnings] for each sent question.
const importFieldsOf = (questions) =>
  questions.map((q) => [q.questionType, 'source' in q, 'importWarnings' in q]);

const expectNoImportData = (body) => {
  const text = JSON.stringify(body);
  expect(text).not.toContain(SOURCE.quizIdent);
  expect(text).not.toContain(SOURCE.itemIdent);
  expect(text).not.toContain(SOURCE.slotIdent);
  expect(text).not.toContain(WARNINGS[0]);
};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { _id: USER_ID };
    next();
  });
  app.use('/api/student', studentRouter);
  app.use('/api/quiz', quizRouter);
  return app;
}

let consoleErrorSpy;

beforeAll(() => {
  consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(() => {
  consoleErrorSpy.mockRestore();
});

beforeEach(() => {
  hasStaffAccessInCourse.mockResolvedValue(false);
  getCourseById.mockResolvedValue({ _id: COURSE_ID, courseName: 'CHEM 100', archived: false });
  quizService.getQuizById.mockResolvedValue({
    _id: new ObjectId(QUIZ_ID),
    name: 'Thermochemistry quiz',
    published: true,
    courseId: COURSE_ID,
    deliveryFormat: 'all-approved',
    source: { kind: SOURCE.kind, quizIdent: SOURCE.quizIdent },
    importLinkedItems: LINKED_ITEMS,
  });
  quizService.getQuizQuestionsForStudent.mockResolvedValue(importedQuestions());
  quizService.getQuizQuestions.mockResolvedValue(importedQuestions());
  quizScheduleService.getStudentSectionObjectIds.mockResolvedValue([new ObjectId().toString()]);
  quizScheduleService.getSchedulesForQuiz.mockResolvedValue([]);
  quizScheduleService.resolveWindow.mockReturnValue({
    accessibleNow: true,
    releaseDate: new Date('2026-10-01T00:00:00.000Z'),
    expireDate: new Date('2026-10-31T00:00:00.000Z'),
    reason: 'open',
  });
  quizSessionService.getOrCreateSession.mockResolvedValue({
    startedAt: new Date('2026-10-07T12:00:00.000Z'),
    expiresAt: new Date('2026-10-07T13:00:00.000Z'),
    timeLimitMinutes: 60,
  });
  // No prior attempts or score for the previous-answers lookup.
  databaseService.connect.mockResolvedValue({
    collection: jest.fn(() => ({
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn(() => ({ toArray: jest.fn().mockResolvedValue([]) })),
    })),
  });
});

describe('graded student quiz (GET /api/student/quizzes/:quizId/questions)', () => {
  it('sends no import provenance or warnings for any question type', async () => {
    const res = await request(buildApp()).get(`/api/student/quizzes/${QUIZ_ID}/questions`);

    expect(res.status).toBe(200);
    const { questions } = res.body.data;
    expect(importFieldsOf(questions)).toEqual(TYPES_SENT.map((type) => [type, false, false]));
    expectNoImportData(res.body);
  });
});

describe('quiz question list (GET /api/quiz/:quizId/questions)', () => {
  it('drops them for a student, for every question type', async () => {
    const res = await request(buildApp()).get(`/api/quiz/${QUIZ_ID}/questions`);

    expect(res.status).toBe(200);
    expect(importFieldsOf(res.body.questions)).toEqual(TYPES_SENT.map((type) => [type, false, false]));
    expectNoImportData(res.body);
  });

  it('drops them from the approved-only student selection even for staff (retake path)', async () => {
    hasStaffAccessInCourse.mockResolvedValue(true);

    const res = await request(buildApp()).get(`/api/quiz/${QUIZ_ID}/questions?approvedOnly=true`);

    expect(res.status).toBe(200);
    expect(quizService.getQuizQuestionsForStudent).toHaveBeenCalledTimes(1);
    expect(importFieldsOf(res.body.questions)).toEqual(TYPES_SENT.map((type) => [type, false, false]));
    expectNoImportData(res.body);
  });

  it('keeps them in the instructor view, which the edit modal reads', async () => {
    hasStaffAccessInCourse.mockResolvedValue(true);

    const res = await request(buildApp()).get(`/api/quiz/${QUIZ_ID}/questions`);

    expect(res.status).toBe(200);
    expect(quizService.getQuizQuestions).toHaveBeenCalledTimes(1);
    res.body.questions.forEach((q) => {
      expect(q.source).toEqual(SOURCE);
      expect(q.importWarnings).toEqual(WARNINGS);
    });
  });
});

describe('quiz documents a student can fetch', () => {
  const importedQuiz = () => ({
    _id: new ObjectId(QUIZ_ID),
    name: 'Thermochemistry quiz',
    published: true,
    courseId: COURSE_ID,
    deliveryFormat: 'all-approved',
    source: { kind: SOURCE.kind, quizIdent: SOURCE.quizIdent },
    importLinkedItems: LINKED_ITEMS,
  });

  // [name, has source, has importLinkedItems] for each sent quiz.
  const quizImportFieldsOf = (quizzes) =>
    quizzes.map((q) => [q.name, 'source' in q, 'importLinkedItems' in q]);

  const expectNoQuizImportData = (body) => {
    const text = JSON.stringify(body);
    expect(text).not.toContain(SOURCE.quizIdent);
    LINKED_ITEMS.forEach((ident) => expect(text).not.toContain(ident));
  };

  beforeEach(() => {
    quizService.getQuizzesByCourse.mockResolvedValue([importedQuiz()]);
  });

  it('GET /api/quiz/:quizId leaves out the Canvas source and linked items', async () => {
    const res = await request(buildApp()).get(`/api/quiz/${QUIZ_ID}`);

    expect(res.status).toBe(200);
    expect(quizImportFieldsOf([res.body.quiz])).toEqual([['Thermochemistry quiz', false, false]]);
    expectNoQuizImportData(res.body);
  });

  it('the course quiz list leaves them out for a student and keeps them for staff', async () => {
    const studentRes = await request(buildApp()).get(`/api/quiz/course/${COURSE_ID}`);
    expect(studentRes.status).toBe(200);
    expect(quizImportFieldsOf(studentRes.body.quizzes)).toEqual([['Thermochemistry quiz', false, false]]);
    expectNoQuizImportData(studentRes.body);

    hasStaffAccessInCourse.mockResolvedValue(true);
    const staffRes = await request(buildApp()).get(`/api/quiz/course/${COURSE_ID}`);
    expect(staffRes.status).toBe(200);
    expect(staffRes.body.quizzes[0].source).toEqual({ kind: SOURCE.kind, quizIdent: SOURCE.quizIdent });
    expect(staffRes.body.quizzes[0].importLinkedItems).toEqual(LINKED_ITEMS);
  });

  it('the student overview leaves them out', async () => {
    quizScheduleService.getSchedulesForQuizzes.mockResolvedValue(new Map([[QUIZ_ID, []]]));
    quizSessionService.getUnsubmittedQuizIds.mockResolvedValue(new Set());
    quizService.getApprovedQuestionCountsForQuizzes.mockResolvedValue(new Map([[QUIZ_ID, 5]]));

    const res = await request(buildApp()).get(`/api/quiz/course/${COURSE_ID}/student-overview`);

    expect(res.status).toBe(200);
    expect(res.body.quizzes.map((q) => [q.name, q.questionCount])).toEqual([['Thermochemistry quiz', 5]]);
    expect(quizImportFieldsOf(res.body.quizzes)).toEqual([['Thermochemistry quiz', false, false]]);
    expectNoQuizImportData(res.body);
  });

  it('the student overview leaves them out of a staff preview too', async () => {
    hasStaffAccessInCourse.mockResolvedValue(true);
    quizService.getApprovedQuestionCountsForQuizzes.mockResolvedValue(new Map([[QUIZ_ID, 5]]));

    const res = await request(buildApp()).get(`/api/quiz/course/${COURSE_ID}/student-overview`);

    expect(res.status).toBe(200);
    expect(quizImportFieldsOf(res.body.quizzes)).toEqual([['Thermochemistry quiz', false, false]]);
    expectNoQuizImportData(res.body);
  });
});
