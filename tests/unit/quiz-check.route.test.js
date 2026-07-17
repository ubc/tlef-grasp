// LLM grading paths of POST /api/quiz/:quizId/question/:questionId/check
// (issue #45): open-ended answers are judged by the LLM with graceful
// degradation to manual grading, and fill-in-the-blank answers get an LLM
// rescue fallback that never downgrades an exact match.

const express = require('express');
const request = require('supertest');

jest.mock('../../src/services/quiz', () => ({
  getQuizById: jest.fn(),
  saveStudentPerformance: jest.fn(),
  gradeAttempt: jest.fn(),
}));

jest.mock('../../src/services/question', () => ({
  getQuestion: jest.fn(),
}));

jest.mock('../../src/services/answer-grading', () => ({
  gradeOpenEndedAnswer: jest.fn(),
  gradeFillInTheBlankAnswer: jest.fn(),
}));

jest.mock('../../src/services/quiz-session', () => ({
  getSession: jest.fn(),
  isExpired: jest.fn(),
}));

jest.mock('../../src/middleware/auth', () => ({
  requireRole: () => (_req, _res, next) => next(),
  requirePageRole: () => (_req, _res, next) => next(),
}));

const quizService = require('../../src/services/quiz');
const { getQuestion } = require('../../src/services/question');
const answerGrading = require('../../src/services/answer-grading');
const quizSessionService = require('../../src/services/quiz-session');
const quizRouter = require('../../src/routes/quiz');

function buildApp(user = { _id: 'user-1' }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.use('/api/quiz', quizRouter);
  return app;
}

const checkUrl = '/api/quiz/quiz-1/question/question-1/check';

const openEndedQuestion = {
  _id: 'question-1',
  questionType: 'open-ended',
  question: 'Explain photosynthesis.',
  openEndedSampleAnswer: 'Light reactions produce ATP; the Calvin cycle fixes CO2.',
  openEndedGradingCriteria: 'Mentions light reactions; mentions carbon fixation.',
  learningObjectiveId: 'lo-1',
  bloom: 'Understand',
};

const fibQuestion = {
  _id: 'question-1',
  questionType: 'fill-in-the-blank',
  question: 'The powerhouse of the cell is _________.',
  correctAnswer: 'mitochondrion',
  acceptableAnswers: ['mitochondrion', 'mitochondria'],
  learningObjectiveId: 'lo-1',
  bloom: 'Remember',
};

const mcqQuestion = {
  _id: 'question-1',
  questionType: 'multiple-choice',
  question: 'Which organelle produces most of the cell\'s ATP?',
  options: {
    A: { text: 'Chloroplast', feedback: 'Chloroplasts photosynthesize.' },
    B: { text: 'Mitochondrion', feedback: 'Correct — cellular respiration.' },
    C: { text: 'Ribosome', feedback: 'Ribosomes build proteins.' },
    D: { text: 'Nucleus', feedback: 'The nucleus stores DNA.' },
  },
  correctAnswer: 'B',
  learningObjectiveId: 'lo-1',
  bloom: 'Remember',
};

describe('POST /api/quiz/:quizId/question/:questionId/check', () => {
  let consoleErrorSpy;

  beforeAll(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterAll(() => {
    consoleErrorSpy.mockRestore();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    quizService.getQuizById.mockResolvedValue({ _id: 'quiz-1', courseId: 'course-1' });
    quizService.saveStudentPerformance.mockResolvedValue({});
    quizSessionService.getSession.mockResolvedValue(null);
    quizSessionService.isExpired.mockReturnValue(false);
  });

  describe('open-ended questions', () => {
    it('grades with the LLM judge and records the verdict on the attempt', async () => {
      getQuestion.mockResolvedValue(openEndedQuestion);
      answerGrading.gradeOpenEndedAnswer.mockResolvedValue({
        pass: true,
        overallFeedback: 'You covered both key concepts.',
        criteria: [
          { criterion: 'Light reactions', met: true, comment: 'Covered.' },
        ],
      });

      const res = await request(buildApp())
        .post(checkUrl)
        .send({ answerText: 'Plants convert light to chemical energy.' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        success: true,
        isCorrect: true,
        autoGraded: true,
        openEnded: true,
        feedback: 'You covered both key concepts.',
        criteria: [
          { criterion: 'Light reactions', met: true, comment: 'Covered.' },
        ],
        sampleAnswer: openEndedQuestion.openEndedSampleAnswer,
      });

      expect(answerGrading.gradeOpenEndedAnswer).toHaveBeenCalledWith({
        courseId: 'course-1',
        question: openEndedQuestion.question,
        studentAnswer: 'Plants convert light to chemical energy.',
        sampleAnswer: openEndedQuestion.openEndedSampleAnswer,
        gradingCriteria: openEndedQuestion.openEndedGradingCriteria,
      });
      expect(quizService.saveStudentPerformance).toHaveBeenCalledWith(
        expect.objectContaining({
          isCorrect: true,
          aiGraded: true,
          aiCriteria: [
            { criterion: 'Light reactions', met: true, comment: 'Covered.' },
          ],
          feedbackText: 'You covered both key concepts.',
        })
      );
    });

    it('returns a failing verdict when the judge does not pass the answer', async () => {
      getQuestion.mockResolvedValue(openEndedQuestion);
      answerGrading.gradeOpenEndedAnswer.mockResolvedValue({
        pass: false,
        overallFeedback: 'You did not mention carbon fixation.',
        criteria: [],
      });

      const res = await request(buildApp())
        .post(checkUrl)
        .send({ answerText: 'Something about light.' });

      expect(res.status).toBe(200);
      expect(res.body.isCorrect).toBe(false);
      expect(res.body.autoGraded).toBe(true);
      expect(quizService.saveStudentPerformance).toHaveBeenCalledWith(
        expect.objectContaining({ isCorrect: false, aiGraded: true })
      );
    });

    it('degrades to manual grading when the LLM judge fails', async () => {
      getQuestion.mockResolvedValue(openEndedQuestion);
      answerGrading.gradeOpenEndedAnswer.mockRejectedValue(new Error('provider down'));

      const res = await request(buildApp())
        .post(checkUrl)
        .send({ answerText: 'Some answer.' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        success: true,
        isCorrect: null,
        autoGraded: false,
        openEnded: true,
        sampleAnswer: openEndedQuestion.openEndedSampleAnswer,
      });
      expect(quizService.saveStudentPerformance).toHaveBeenCalledWith(
        expect.objectContaining({ isCorrect: null, aiGraded: false })
      );
    });

    it('rejects when the question is missing a sample answer', async () => {
      getQuestion.mockResolvedValue({ ...openEndedQuestion, openEndedSampleAnswer: '' });

      const res = await request(buildApp())
        .post(checkUrl)
        .send({ answerText: 'Some answer.' });

      expect(res.status).toBe(500);
      expect(answerGrading.gradeOpenEndedAnswer).not.toHaveBeenCalled();
    });

    it('rejects empty answers', async () => {
      getQuestion.mockResolvedValue(openEndedQuestion);

      const res = await request(buildApp()).post(checkUrl).send({ answerText: '   ' });

      expect(res.status).toBe(400);
      expect(answerGrading.gradeOpenEndedAnswer).not.toHaveBeenCalled();
    });
  });

  it('refuses answers after the server-side quiz deadline', async () => {
    quizSessionService.getSession.mockResolvedValue({
      expiresAt: new Date(Date.now() - 1_000),
    });
    quizSessionService.isExpired.mockReturnValue(true);

    const res = await request(buildApp())
      .post(checkUrl)
      .send({ answerText: 'Too late' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('QUIZ_TIME_EXPIRED');
    expect(getQuestion).not.toHaveBeenCalled();
  });

  describe('fill-in-the-blank questions', () => {
    it('does not call the LLM when the answer matches exactly', async () => {
      getQuestion.mockResolvedValue(fibQuestion);

      const res = await request(buildApp())
        .post(checkUrl)
        .send({ answerText: '  Mitochondria ' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        isCorrect: true,
        feedback: 'Correct.',
        aiGraded: false,
        correctAnswer: 'mitochondrion',
      });
      expect(answerGrading.gradeFillInTheBlankAnswer).not.toHaveBeenCalled();
    });

    it('rescues an equivalent answer via the LLM fallback', async () => {
      getQuestion.mockResolvedValue(fibQuestion);
      answerGrading.gradeFillInTheBlankAnswer.mockResolvedValue({
        correct: true,
        feedback: 'Your longer phrasing names the same organelle.',
      });

      const res = await request(buildApp())
        .post(checkUrl)
        .send({ answerText: 'the mitochondria of the cell' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        isCorrect: true,
        aiGraded: true,
        feedback: 'Your longer phrasing names the same organelle.',
        correctAnswer: 'mitochondrion',
      });
      expect(answerGrading.gradeFillInTheBlankAnswer).toHaveBeenCalledWith({
        courseId: 'course-1',
        question: fibQuestion.question,
        studentAnswer: 'the mitochondria of the cell',
        correctAnswer: 'mitochondrion',
        acceptableAnswers: fibQuestion.acceptableAnswers,
      });
      expect(quizService.saveStudentPerformance).toHaveBeenCalledWith(
        expect.objectContaining({
          isCorrect: true,
          aiGraded: true,
          feedbackText: 'Your longer phrasing names the same organelle.',
        })
      );
    });

    it('keeps the answer incorrect when the LLM does not rescue it', async () => {
      getQuestion.mockResolvedValue(fibQuestion);
      answerGrading.gradeFillInTheBlankAnswer.mockResolvedValue({
        correct: false,
        feedback: 'You named a different organelle.',
      });

      const res = await request(buildApp())
        .post(checkUrl)
        .send({ answerText: 'chloroplast' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        isCorrect: false,
        aiGraded: true,
        feedback: 'You named a different organelle.',
        correctAnswer: null,
      });
    });

    it('keeps the exact-match verdict when the LLM fallback fails', async () => {
      getQuestion.mockResolvedValue(fibQuestion);
      answerGrading.gradeFillInTheBlankAnswer.mockRejectedValue(new Error('provider down'));

      const res = await request(buildApp())
        .post(checkUrl)
        .send({ answerText: 'chloroplast' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        isCorrect: false,
        aiGraded: false,
        feedback: '',
      });
      expect(quizService.saveStudentPerformance).toHaveBeenCalledWith(
        expect.objectContaining({ isCorrect: false, aiGraded: false, feedbackText: null })
      );
    });

    it('does not call the LLM for an empty answer', async () => {
      getQuestion.mockResolvedValue(fibQuestion);

      const res = await request(buildApp()).post(checkUrl).send({ answerText: '' });

      expect(res.status).toBe(200);
      expect(res.body.isCorrect).toBe(false);
      expect(answerGrading.gradeFillInTheBlankAnswer).not.toHaveBeenCalled();
    });
  });

  describe('multiple-choice questions', () => {
    it('reveals the correct answer on a wrong selection and persists it', async () => {
      getQuestion.mockResolvedValue(mcqQuestion);

      const res = await request(buildApp())
        .post(checkUrl)
        .send({ selectedIndex: 0 });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        success: true,
        isCorrect: false,
        feedback: 'Chloroplasts photosynthesize.',
        correctAnswer: 'B',
        correctOptionText: 'Mitochondrion',
      });
      expect(quizService.saveStudentPerformance).toHaveBeenCalledWith(
        expect.objectContaining({
          isCorrect: false,
          selectedAnswer: 'A',
          correctAnswer: 'B',
          correctOptionText: 'Mitochondrion',
        })
      );
    });

    it('returns the correct answer fields on a right selection', async () => {
      getQuestion.mockResolvedValue(mcqQuestion);

      const res = await request(buildApp())
        .post(checkUrl)
        .send({ selectedIndex: 1 });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        success: true,
        isCorrect: true,
        feedback: 'Correct — cellular respiration.',
        correctAnswer: 'B',
        correctOptionText: 'Mitochondrion',
      });
    });

    it('rejects a missing selectedIndex', async () => {
      getQuestion.mockResolvedValue(mcqQuestion);

      const res = await request(buildApp()).post(checkUrl).send({});

      expect(res.status).toBe(400);
      expect(quizService.saveStudentPerformance).not.toHaveBeenCalled();
    });
  });
});

describe('PUT /api/quiz/:quizId/student/:userId/grade', () => {
  let consoleErrorSpy;

  beforeAll(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterAll(() => {
    consoleErrorSpy.mockRestore();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const gradeUrl = '/api/quiz/quiz-1/student/student-1/grade';

  it('applies an instructor grade/override', async () => {
    quizService.gradeAttempt.mockResolvedValue({
      score: 80,
      correctAnswers: 4,
      totalQuestions: 5,
    });

    const res = await request(buildApp())
      .put(gradeUrl)
      .send({ questionId: 'question-1', isCorrect: true });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      score: 80,
      correctAnswers: 4,
      totalQuestions: 5,
    });
    expect(quizService.gradeAttempt).toHaveBeenCalledWith(
      'student-1',
      'quiz-1',
      'question-1',
      true
    );
  });

  it('overrides an AI-graded fill-in-the-blank attempt via the same endpoint', async () => {
    quizService.gradeAttempt.mockResolvedValue({
      score: 60,
      correctAnswers: 3,
      totalQuestions: 5,
    });

    const res = await request(buildApp())
      .put(gradeUrl)
      .send({ questionId: 'fib-question-1', isCorrect: false });

    expect(res.status).toBe(200);
    expect(res.body.score).toBe(60);
    expect(quizService.gradeAttempt).toHaveBeenCalledWith(
      'student-1',
      'quiz-1',
      'fib-question-1',
      false
    );
  });

  it('rejects a non-boolean isCorrect', async () => {
    const res = await request(buildApp())
      .put(gradeUrl)
      .send({ questionId: 'question-1', isCorrect: 'yes' });

    expect(res.status).toBe(400);
    expect(quizService.gradeAttempt).not.toHaveBeenCalled();
  });

  it('maps a missing/ineligible attempt to 404', async () => {
    quizService.gradeAttempt.mockRejectedValue(new Error('Attempt not found'));

    const res = await request(buildApp())
      .put(gradeUrl)
      .send({ questionId: 'mcq-question-1', isCorrect: true });

    expect(res.status).toBe(404);
  });

  it('maps an already-finalized grade to 409', async () => {
    quizService.gradeAttempt.mockRejectedValue(
      new Error('Attempt has already been graded')
    );

    const res = await request(buildApp())
      .put(gradeUrl)
      .send({ questionId: 'question-1', isCorrect: false });

    expect(res.status).toBe(409);
  });
});
