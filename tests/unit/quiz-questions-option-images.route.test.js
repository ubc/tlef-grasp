// GET /api/quiz/:quizId/questions with option images (issue #146): staff get
// the stored image ref; anyone the answers are withheld from gets only the
// file id and the alt text, since the stored filename could name the answer.

const express = require('express');
const request = require('supertest');

jest.mock('../../src/services/quiz', () => ({
  getQuizById: jest.fn(),
  getQuizQuestions: jest.fn(),
  getQuizQuestionsForStudent: jest.fn(),
}));
// Loading the router would otherwise start the LLM client.
jest.mock('../../src/services/answer-grading', () => ({}));
jest.mock('../../src/services/user-course', () => ({
  isUserInCourse: jest.fn().mockResolvedValue(true),
}));
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
// Anyone the answers are withheld from goes through the student quiz rules
// (issue #168): here a student who may open the quiz.
jest.mock('../../src/services/student-quiz-access', () => ({
  resolveStudentQuizAccess: jest.fn(),
}));
jest.mock('../../src/services/quiz-session', () => ({
  getOrCreateSession: jest.fn(),
}));

const quizService = require('../../src/services/quiz');
const { hasStaffAccessInCourse } = require('../../src/utils/course-access');
const { resolveStudentQuizAccess } = require('../../src/services/student-quiz-access');
const quizSessionService = require('../../src/services/quiz-session');
const quizRouter = require('../../src/routes/quiz');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { _id: 'user-1' };
    next();
  });
  app.use('/api/quiz', quizRouter);
  return app;
}

const IMAGE = {
  fileId: '665f1a0000000000000000aa',
  filename: 'benzene.png',
  mimeType: 'image/png',
  size: 1234,
  caption: 'Ring structure',
};

const question = {
  _id: 'question-1',
  questionType: 'multiple-choice',
  title: 'Which structure is benzene?',
  options: {
    A: { text: '', feedback: 'Yes', image: IMAGE },
    B: { text: 'Cyclohexane', feedback: 'No' },
  },
  correctAnswer: 'A',
};

describe('GET /api/quiz/:quizId/questions option images', () => {
  beforeEach(() => {
    quizService.getQuizById.mockResolvedValue({ _id: 'quiz-1', courseId: 'course-1' });
    quizService.getQuizQuestions.mockResolvedValue([question]);
    quizService.getQuizQuestionsForStudent.mockResolvedValue([question]);
    resolveStudentQuizAccess.mockResolvedValue({ success: true, scheduledExpiresAt: null });
    quizSessionService.getOrCreateSession.mockResolvedValue({});
  });

  it('gives staff the stored option image', async () => {
    hasStaffAccessInCourse.mockResolvedValue(true);

    const res = await request(buildApp()).get('/api/quiz/quiz-1/questions');

    expect(res.status).toBe(200);
    expect(res.body.questions[0].options.A.image).toEqual(IMAGE);
  });

  it('withholds the filename along with the feedback and the answer', async () => {
    hasStaffAccessInCourse.mockResolvedValue(false);

    const res = await request(buildApp()).get('/api/quiz/quiz-1/questions');

    expect(res.status).toBe(200);
    const [sent] = res.body.questions;
    expect(sent.options.A).toEqual({
      text: '',
      image: { fileId: IMAGE.fileId, caption: IMAGE.caption },
      index: 0,
    });
    expect(sent.options.B).toEqual({ text: 'Cyclohexane', index: 1 });
    expect(sent.correctAnswer).toBeUndefined();
  });

  it('serves no questions of a quiz the student cannot open (issue #168)', async () => {
    hasStaffAccessInCourse.mockResolvedValue(false);
    resolveStudentQuizAccess.mockResolvedValue({
      success: false,
      status: 403,
      message: 'This quiz is not available. Only published quizzes can be accessed.',
    });

    const res = await request(buildApp()).get('/api/quiz/quiz-1/questions?approvedOnly=true');

    expect(res.status).toBe(403);
    expect(res.body.questions).toBeUndefined();
    expect(quizService.getQuizQuestionsForStudent).not.toHaveBeenCalled();
    expect(quizSessionService.getOrCreateSession).not.toHaveBeenCalled();
  });
});
