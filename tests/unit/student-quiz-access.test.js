const express = require('express');
const request = require('supertest');
const { ObjectId } = require('mongodb');

jest.mock('../../src/services/user-course', () => ({
  getStudentCourses: jest.fn(),
}));

jest.mock('../../src/services/quiz', () => ({
  getQuizById: jest.fn(),
  getQuizQuestions: jest.fn(),
  getQuizQuestionsForStudent: jest.fn(),
  saveQuizScore: jest.fn(),
  saveStudentPerformance: jest.fn(),
}));

jest.mock('../../src/services/quiz-schedule', () => ({
  getStudentSectionObjectIds: jest.fn(),
  getSchedulesForQuiz: jest.fn(),
  resolveWindow: jest.fn(),
}));

jest.mock('../../src/utils/course-access', () => ({
  hasStaffAccessInCourse: jest.fn(),
}));

jest.mock('../../src/models/questions/CalculationQuestion', () => ({
  resolveCalculationDisplayTemplate: jest.fn(),
  buildStudentCalculationInstance: jest.fn(),
  verifyCalculationToken: jest.fn(),
  evaluateCalculationFormula: jest.fn(),
  parseStudentNumericAnswer: jest.fn(),
  numericAnswersMatch: jest.fn(),
  formatAnswerForDisplay: jest.fn(),
}));

jest.mock('../../src/services/achievement', () => ({
  awardQuizAchievements: jest.fn(),
}));

jest.mock('../../src/services/course', () => ({
  getCourseById: jest.fn(),
}));

jest.mock('../../src/services/database', () => ({
  connect: jest.fn(),
}));

jest.mock('../../src/services/quiz-session', () => ({
  getOrCreateSession: jest.fn(),
  getSession: jest.fn(),
  recordQuestionCount: jest.fn(),
  markSubmitted: jest.fn(),
}));

const quizService = require('../../src/services/quiz');
const quizScheduleService = require('../../src/services/quiz-schedule');
const { hasStaffAccessInCourse } = require('../../src/utils/course-access');
const achievementService = require('../../src/services/achievement');
const { getCourseById } = require('../../src/services/course');
const databaseService = require('../../src/services/database');
const quizSessionService = require('../../src/services/quiz-session');
const studentRouter = require('../../src/routes/student');

const USER_ID = new ObjectId().toString();
const QUIZ_ID = new ObjectId().toString();
const COURSE_ID = new ObjectId();
const SECTION_ID = new ObjectId().toString();

function buildApp(user = { _id: USER_ID }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.use('/student', studentRouter);
  return app;
}

// One in-memory stand-in per collection: findOne resolves `doc`, find().toArray()
// resolves `docs`.
function mockDb({ scoreDoc = null, attemptDocs = [] } = {}) {
  const collections = {
    grasp_quiz_score: {
      findOne: jest.fn().mockResolvedValue(scoreDoc),
    },
    grasp_student_attempt: {
      findOne: jest.fn().mockResolvedValue(attemptDocs[0] || null),
      find: jest.fn(() => ({ toArray: jest.fn().mockResolvedValue(attemptDocs) })),
    },
  };
  databaseService.connect.mockResolvedValue({
    collection: jest.fn((name) => collections[name]),
  });
  return collections;
}

function mockExpiredWindow() {
  quizScheduleService.getStudentSectionObjectIds.mockResolvedValue([SECTION_ID]);
  quizScheduleService.getSchedulesForQuiz.mockResolvedValue([
    {
      courseSectionId: SECTION_ID,
      releaseDate: new Date('2026-01-01T00:00:00Z'),
      expireDate: new Date('2026-01-02T00:00:00Z'),
    },
  ]);
  quizScheduleService.resolveWindow.mockReturnValue({
    accessibleNow: false,
    releaseDate: new Date('2026-01-01T00:00:00Z'),
    expireDate: new Date('2026-01-02T00:00:00Z'),
    reason: 'expired',
  });
}

function mockOpenWindow() {
  quizScheduleService.getStudentSectionObjectIds.mockResolvedValue([SECTION_ID]);
  quizScheduleService.getSchedulesForQuiz.mockResolvedValue([]);
  quizScheduleService.resolveWindow.mockReturnValue({
    accessibleNow: true,
    releaseDate: new Date(),
    expireDate: new Date(),
    reason: 'open',
  });
}

const publishedQuiz = () => ({
  _id: new ObjectId(QUIZ_ID),
  name: 'Midterm Review',
  published: true,
  courseId: COURSE_ID,
});

const mcqAttempt = (overrides = {}) => ({
  userId: new ObjectId(USER_ID),
  quizId: new ObjectId(QUIZ_ID),
  questionId: new ObjectId(),
  questionType: 'multiple-choice',
  selectedAnswer: 'A',
  isCorrect: true,
  correctAnswer: 'A',
  ...overrides,
});

describe('student quiz access past the expiry window (#37)', () => {
  let consoleErrorSpy;

  beforeAll(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterAll(() => {
    consoleErrorSpy.mockRestore();
  });

  beforeEach(() => {
    hasStaffAccessInCourse.mockResolvedValue(false);
    quizService.getQuizById.mockResolvedValue(publishedQuiz());
    achievementService.awardQuizAchievements.mockResolvedValue([]);
    quizService.saveQuizScore.mockResolvedValue({});
    getCourseById.mockResolvedValue({ courseName: 'BIOL 200' });
    quizSessionService.getOrCreateSession.mockResolvedValue({
      startedAt: new Date('2026-01-01T00:00:00Z'),
      expiresAt: new Date('2026-01-01T01:00:00Z'),
      timeLimitMinutes: 60,
    });
    quizSessionService.getSession.mockResolvedValue(null);
    quizSessionService.recordQuestionCount.mockResolvedValue(undefined);
    quizSessionService.markSubmitted.mockResolvedValue({});
  });

  describe('POST /student/quizzes/:quizId/submit', () => {
    it('accepts a submission after expiry when the student has an in-progress attempt', async () => {
      mockExpiredWindow();
      mockDb({
        scoreDoc: null,
        attemptDocs: [
          mcqAttempt({ isCorrect: true }),
          mcqAttempt({ isCorrect: false, selectedAnswer: 'B' }),
          // Open-ended answers are recorded but ungraded (isCorrect: null).
          mcqAttempt({ questionType: 'open-ended', isCorrect: null }),
        ],
      });

      const res = await request(buildApp())
        .post(`/student/quizzes/${QUIZ_ID}/submit`)
        .send({ timeSpent: 60000, sessionId: 's1' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        score: 50,
        correctAnswers: 1,
        totalQuestions: 2,
      });
      expect(quizService.saveQuizScore).toHaveBeenCalledWith(
        expect.objectContaining({ quizId: QUIZ_ID, score: 50 })
      );
    });

    it('still rejects after expiry when the student never started the quiz', async () => {
      mockExpiredWindow();
      mockDb({ scoreDoc: null, attemptDocs: [] });

      const res = await request(buildApp())
        .post(`/student/quizzes/${QUIZ_ID}/submit`)
        .send({ timeSpent: 60000, sessionId: 's1' });

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/expired/i);
      expect(quizService.saveQuizScore).not.toHaveBeenCalled();
    });

    it('rejects after expiry when the attempt was already submitted (score exists)', async () => {
      mockExpiredWindow();
      mockDb({
        scoreDoc: { userId: new ObjectId(USER_ID), quizId: new ObjectId(QUIZ_ID), score: 80 },
        attemptDocs: [mcqAttempt()],
      });

      const res = await request(buildApp())
        .post(`/student/quizzes/${QUIZ_ID}/submit`)
        .send({ timeSpent: 60000, sessionId: 's1' });

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/expired/i);
      expect(quizService.saveQuizScore).not.toHaveBeenCalled();
    });

    it('accepts submissions normally while the window is open', async () => {
      mockOpenWindow();
      mockDb({ scoreDoc: null, attemptDocs: [mcqAttempt()] });

      const res = await request(buildApp())
        .post(`/student/quizzes/${QUIZ_ID}/submit`)
        .send({ timeSpent: 60000, sessionId: 's1' });

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ score: 100, correctAnswers: 1 });
    });
  });

  describe('GET /student/quizzes/:quizId/questions', () => {
    it('lets a student resume (with previous answers) after expiry when an attempt exists', async () => {
      mockExpiredWindow();
      const attempt = mcqAttempt();
      mockDb({ scoreDoc: null, attemptDocs: [attempt] });
      quizService.getQuizQuestionsForStudent.mockResolvedValue([
        {
          _id: attempt.questionId,
          title: 'What is 2 + 2?',
          questionType: 'multiple-choice',
          options: { A: '4', B: '5', C: '6', D: '7' },
        },
      ]);

      const res = await request(buildApp()).get(
        `/student/quizzes/${QUIZ_ID}/questions`
      );

      expect(res.status).toBe(200);
      expect(res.body.data.questions).toHaveLength(1);
      expect(res.body.data.disablePreviousNavigation).toBe(false);
      expect(
        res.body.data.previousAnswers[attempt.questionId.toString()]
      ).toMatchObject({ selectedAnswer: 'A', isCorrect: true, selectedIndex: 0 });
    });

    it('returns the per-quiz previous-navigation setting to the student UI', async () => {
      mockOpenWindow();
      const questionId = new ObjectId();
      mockDb({ scoreDoc: null, attemptDocs: [] });
      quizService.getQuizById.mockResolvedValue({
        ...publishedQuiz(),
        disablePreviousNavigation: true,
      });
      quizService.getQuizQuestionsForStudent.mockResolvedValue([
        {
          _id: questionId,
          title: 'What is 2 + 2?',
          questionType: 'multiple-choice',
          options: { A: '4', B: '5', C: '6', D: '7' },
        },
      ]);

      const res = await request(buildApp()).get(
        `/student/quizzes/${QUIZ_ID}/questions`
      );

      expect(res.status).toBe(200);
      expect(res.body.data.disablePreviousNavigation).toBe(true);
    });

    it('still blocks loading questions after expiry with no attempt', async () => {
      mockExpiredWindow();
      mockDb({ scoreDoc: null, attemptDocs: [] });

      const res = await request(buildApp()).get(
        `/student/quizzes/${QUIZ_ID}/questions`
      );

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/expired/i);
    });
  });

  // Issue #65: a student who runs out of time is scored against every question
  // they were served, not just the ones they managed to answer.
  describe('score denominator (#65)', () => {
    it('scores a timed-out submission out of the full served question count', async () => {
      mockOpenWindow();
      mockDb({
        scoreDoc: null,
        attemptDocs: [
          mcqAttempt({ isCorrect: true }),
          mcqAttempt({ isCorrect: false, selectedAnswer: 'B' }),
        ],
      });
      quizSessionService.getSession.mockResolvedValue({
        startedAt: new Date(Date.now() - 60000),
        expiresAt: new Date(),
        timeLimitMinutes: 60,
        questionCount: 10,
      });

      const res = await request(buildApp())
        .post(`/student/quizzes/${QUIZ_ID}/submit`)
        .send({ timeSpent: 60000, sessionId: 's1' });

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        score: 10,
        correctAnswers: 1,
        totalQuestions: 10,
      });
      expect(quizService.saveQuizScore).toHaveBeenCalledWith(
        expect.objectContaining({ score: 10, correctAnswers: 1, totalQuestions: 10 })
      );
    });

    it('records the served question count when questions are delivered', async () => {
      mockOpenWindow();
      mockDb({ scoreDoc: null, attemptDocs: [] });
      quizService.getQuizQuestionsForStudent.mockResolvedValue([
        {
          _id: new ObjectId(),
          title: 'What is 2 + 2?',
          questionType: 'multiple-choice',
          options: { A: '4', B: '5', C: '6', D: '7' },
        },
      ]);

      const res = await request(buildApp()).get(
        `/student/quizzes/${QUIZ_ID}/questions`
      );

      expect(res.status).toBe(200);
      expect(quizSessionService.recordQuestionCount).toHaveBeenCalledWith(
        USER_ID,
        QUIZ_ID,
        1
      );
    });
  });
});
