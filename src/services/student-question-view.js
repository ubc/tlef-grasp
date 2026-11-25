// What a student is sent for each quiz question, the same on a first attempt
// (GET /api/student/quizzes/:quizId/questions) and on a retake
// (GET /api/quiz/:quizId/questions for anyone answers are withheld from).
// Issues #177 and #223: the two used to build this separately and drifted.
//
// Each view lists the fields it sends, so nothing stored on a question (its
// answer, option feedback, grading criteria, Canvas import provenance, an
// image's filename) reaches a student unless it is named here.

const { QUESTION_TYPES } = require('../constants/app-constants');
const CalculationQuestion = require('../models/questions/CalculationQuestion');
const { optionKeysOf, optionAt, optionTextOf } = require('../utils/mc-options');
const { promptOf } = require('../utils/question-prompt');
const { resolveQuestionType } = require('../utils/question-type');

const MISSING_TEXT = 'Question text not available';
const CALCULATION_LOAD_ERROR =
  'This calculation question could not be loaded. Please contact your instructor.';

function questionIdOf(question, index) {
  if (question._id) return String(question._id);
  return String(question.id || index + 1);
}

function stemImagesOf(question) {
  if (question.stemImages) return question.stemImages;
  return question.stemImage ? [question.stemImage] : [];
}

// The fields every type sends.
function baseView(question, index, questionType) {
  const view = {
    id: questionIdOf(question, index),
    question: promptOf(question) || MISSING_TEXT,
    questionType,
    stemImages: stemImagesOf(question),
    options: {},
    learningObjectiveId: question.learningObjectiveId,
    granularObjectiveId: question.granularObjectiveId,
    bloom: question.bloom,
  };
  // Shown to instructors previewing the quiz.
  if (question.learningObjectiveName) view.learningObjectiveName = question.learningObjectiveName;
  if (question.granularObjectiveName) view.granularObjectiveName = question.granularObjectiveName;
  return view;
}

// Multiple choice and multiple answer: the option text only, keyed by letter
// (two to eight). An option with an image (issue #146) is sent as
// { text, image } with just the file id and the alt text: the stored filename
// could name the answer.
function choiceOptionsOf(question) {
  const options = {};
  optionKeysOf(question.options).forEach((key) => {
    const raw = optionAt(question.options, key);
    const text = optionTextOf(raw);
    const image = raw && typeof raw === 'object' ? raw.image : null;
    options[key] = image?.fileId
      ? { text, image: { fileId: String(image.fileId), caption: image.caption || '' } }
      : text;
  });
  return options;
}

// A calculation question is sent as one instance with its variables filled
// in, and a token that lets the server grade that instance.
function calculationView(question, index) {
  const view = baseView(question, index, QUESTION_TYPES.CALCULATION);
  const variableSpecs = question.calculationVariables;
  const template = CalculationQuestion.resolveCalculationDisplayTemplate(
    question.stem,
    question.title,
    variableSpecs
  );
  const formula = (question.calculationFormula || '').trim();
  const { answerDec, tolerance, tolerancePercent } = CalculationQuestion.readGradingSettings(question);
  const built = CalculationQuestion.buildStudentCalculationInstance({
    template,
    formula,
    variableSpecs,
    qid: view.id,
    answerDec,
  });

  if (built.ok) {
    return {
      ...view,
      question: built.rendered,
      calculationToken: built.token,
      answerDecimalPlaces: built.answerDecimalPlaces,
      // The rule the student is graded by, minus a range's bounds.
      calculationTolerance: CalculationQuestion.toleranceForStudent(tolerance),
      calculationAnswerTolerancePercent: tolerancePercent,
    };
  }

  console.error('Calculation question instance failed:', view.id, built.error && built.error.message);
  return {
    ...view,
    question: template || CALCULATION_LOAD_ERROR,
    calculationToken: null,
    answerDecimalPlaces: answerDec,
    calculationLoadError: true,
  };
}

function toStudentQuestion(question, index = 0) {
  const questionType = resolveQuestionType(question);
  switch (questionType) {
    case QUESTION_TYPES.CALCULATION:
      return calculationView(question, index);
    case QUESTION_TYPES.MULTIPLE_CHOICE:
    case QUESTION_TYPES.MULTIPLE_ANSWER:
      return { ...baseView(question, index, questionType), options: choiceOptionsOf(question) };
    default:
      // Fill-in-the-blank and open-ended: the prompt, no options.
      return baseView(question, index, questionType);
  }
}

function toStudentQuestions(questions) {
  return (questions || []).map((question, index) => toStudentQuestion(question, index));
}

module.exports = {
  toStudentQuestion,
  toStudentQuestions,
};
