const MultipleChoiceQuestion = require('./MultipleChoiceQuestion');
const FillInTheBlankQuestion = require('./FillInTheBlankQuestion');
const OpenEndedQuestion = require('./OpenEndedQuestion');
const CalculationQuestion = require('./CalculationQuestion');
const { QUESTION_TYPES } = require('../../constants/app-constants');

class QuestionFactory {
    static getModel(questionType) {
        switch (questionType) {
            case QUESTION_TYPES.MULTIPLE_CHOICE:
                return MultipleChoiceQuestion;
            case QUESTION_TYPES.FILL_IN_THE_BLANK:
                return FillInTheBlankQuestion;
            case QUESTION_TYPES.OPEN_ENDED:
                return OpenEndedQuestion;
            case QUESTION_TYPES.CALCULATION:
                return CalculationQuestion;
            default:
                throw new Error(`Unsupported question type: ${questionType}`);
        }
    }
}

module.exports = QuestionFactory;
