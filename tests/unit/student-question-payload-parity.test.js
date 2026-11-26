// A first attempt and a retake send a student the same thing for every
// question type (issues #177, #223). The first attempt loads
// GET /api/student/quizzes/:quizId/questions; a retake loads
// GET /api/quiz/:quizId/questions?approvedOnly=true. Both used to build their
// own view and drifted apart.

const express = require('express');
const request = require('supertest');
const { ObjectId } = require('mongodb');

jest.mock('../../src/services/user-course', () => ({
  getStudentCourses: jest.fn(),
  isUserInCourse: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../src/services/quiz', () => ({
  getQuizById: jest.fn(),
  getQuizQuestions: jest.fn(),
  getQuizQuestionsForStudent: jest.fn(),
}));
jest.mock('../../src/services/quiz-schedule', () => ({
  getStudentSectionObjectIds: jest.fn(),
  getSchedulesForQuiz: jest.fn(),
  resolveWindow: jest.fn(),
}));
// Loading the quiz router would otherwise start the LLM client.
jest.mock('../../src/services/answer-grading', () => ({}));
jest.mock('../../src/utils/auth', () => ({
  ...jest.requireActual('../../src/utils/auth'),
  isFaculty: jest.fn().mockResolvedValue(false),
}));
jest.mock('../../src/utils/course-access', () => ({
  hasStaffAccessInCourse: jest.fn().mockResolvedValue(false),
}));
jest.mock('../../src/middleware/auth', () => ({
  requireRole: () => (_req, _res, next) => next(),
  requirePageRole: () => (_req, _res, next) => next(),
}));
jest.mock('../../src/services/student-quiz-access', () => ({
  resolveStudentQuizAccess: jest.fn().mockResolvedValue({ success: true, scheduledExpiresAt: null }),
}));
jest.mock('../../src/services/quiz-session', () => ({
  getOrCreateSession: jest.fn().mockResolvedValue({}),
  recordQuestionCount: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../src/services/student-quiz-delivery', () => ({
  getStudentQuestions: jest.fn(),
}));
jest.mock('../../src/services/achievement', () => ({ awardQuizAchievements: jest.fn() }));
jest.mock('../../src/services/course', () => ({ getCourseById: jest.fn().mockResolvedValue(null) }));
jest.mock('../../src/services/database', () => ({
  connect: jest.fn().mockResolvedValue({
    collection: () => ({
      findOne: jest.fn().mockResolvedValue(null),
      find: () => ({ toArray: jest.fn().mockResolvedValue([]) }),
    }),
  }),
}));
// Each request builds a fresh calculation instance; make it the same one so
// the two payloads can be compared.
jest.mock('../../src/models/questions/CalculationQuestion', () => ({
  resolveCalculationDisplayTemplate: jest.fn((stem, title) => stem || title || ''),
  buildStudentCalculationInstance: jest.fn(() => ({
    ok: true,
    rendered: 'Compute 2 + 3',
    token: 'token',
    answerDecimalPlaces: 2,
  })),
  readGradingSettings: jest.fn(() => ({ answerDec: 2, tolerance: null, tolerancePercent: null })),
  toleranceForStudent: jest.fn(() => null),
}));

const quizService = require('../../src/services/quiz');
const studentQuizDelivery = require('../../src/services/student-quiz-delivery');

const QUIZ_ID = new ObjectId().toString();
const image = { fileId: new ObjectId().toString(), filename: 'answer.png', caption: 'Ring' };

const QUESTIONS = {
  'multiple choice, from the wizard (#177)': {
    questionType: 'multiple-choice',
    title: 'Kinetic energy formula',
    stem: 'What is the kinetic energy of a 2 kg object moving at 3 m/s?',
    options: { A: { text: '6 J', feedback: 'No' }, B: { text: '9 J', feedback: 'Yes', image } },
    correctAnswer: 'B',
  },
  'multiple choice, AI-made': {
    questionType: 'multiple-choice',
    title: 'What is 2 + 2?',
    stem: 'Select the best answer:',
    options: { A: '3', B: '4' },
    correctAnswer: 'B',
    source: { kind: 'canvas-classic' },
    importWarnings: ['Converted'],
  },
  'multiple answer': {
    questionType: 'multiple-answer',
    title: 'Noble gases',
    stem: 'Which of these are noble gases?',
    options: { A: 'Neon', B: 'Nitrogen', C: 'Argon' },
    correctAnswer: ['A', 'C'],
  },
  'fill-in-the-blank': {
    questionType: 'fill-in-the-blank',
    title: 'Cells',
    stem: 'The powerhouse of the cell is the _________.',
    correctAnswer: 'mitochondria',
    acceptableAnswers: ['mitochondria'],
  },
  'open-ended': {
    questionType: 'open-ended',
    title: 'Osmosis',
    stem: 'Explain osmosis.',
    openEndedSampleAnswer: 'Water moves...',
    openEndedGradingCriteria: 'Mentions a membrane',
  },
  calculation: {
    questionType: 'calculation',
    title: 'Addition',
    stem: 'Compute {{x}} + {{y}}',
    calculationFormula: 'x + y',
    calculationVariables: [{ name: 'x' }, { name: 'y' }],
  },
};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { _id: new ObjectId().toString() };
    next();
  });
  app.use('/api/student', require('../../src/routes/student'));
  app.use('/api/quiz', require('../../src/routes/quiz'));
  return app;
}

async function bothPayloads(stored) {
  quizService.getQuizById.mockResolvedValue({ _id: QUIZ_ID, courseId: new ObjectId().toString() });
  studentQuizDelivery.getStudentQuestions.mockResolvedValue([stored]);
  const app = buildApp();
  const first = await request(app).get(`/api/student/quizzes/${QUIZ_ID}/questions`);
  const retake = await request(app).get(`/api/quiz/${QUIZ_ID}/questions?approvedOnly=true`);
  expect(first.status).toBe(200);
  expect(retake.status).toBe(200);
  return { first: first.body.data.questions[0], retake: retake.body.questions[0] };
}

let consoleErrorSpy;
beforeAll(() => {
  consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => consoleErrorSpy.mockRestore());

describe('a first attempt and a retake send the same question', () => {
  test.each(Object.entries(QUESTIONS))('%s', async (_label, question) => {
    const stored = { _id: new ObjectId(), ...question };
    const { first, retake } = await bothPayloads(stored);

    expect(retake).toEqual(first);
    // One prompt, and nothing a student should not see.
    ['stem', 'title', 'correctAnswer', 'acceptableAnswers', 'openEndedSampleAnswer',
      'openEndedGradingCriteria', 'calculationFormula', 'source', 'importWarnings']
      .forEach((field) => expect(first).not.toHaveProperty(field));
  });

  test('the wizard question shows its stem on both (#177)', async () => {
    const { first, retake } = await bothPayloads({
      _id: new ObjectId(),
      ...QUESTIONS['multiple choice, from the wizard (#177)'],
    });

    expect(first.question).toBe('What is the kinetic energy of a 2 kg object moving at 3 m/s?');
    expect(retake.question).toBe(first.question);
  });

  test('an AI-made question shows its title and no generic line on both', async () => {
    const { first, retake } = await bothPayloads({
      _id: new ObjectId(),
      ...QUESTIONS['multiple choice, AI-made'],
    });

    expect(first.question).toBe('What is 2 + 2?');
    expect(JSON.stringify([first, retake])).not.toContain('Select the best answer');
  });
});
