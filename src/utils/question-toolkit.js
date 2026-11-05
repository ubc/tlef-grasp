const { checkChoice, choiceRules } = require('@ubc/genai-toolkit-questions');
const { MC_MIN_OPTIONS } = require('../constants/app-constants');
const { optionKeysOf } = require('./mc-options');

// The one place GRASP calls @ubc/genai-toolkit-questions. Everything else
// imports these functions, not the package. The toolkit's option lists are
// built here, in memory, and never stored.

// The rule lists, in the order that keeps today's error precedence. The toolkit
// quotes GRASP's messages byte for byte, and they go back to the model in its
// retry prompt.
const KEY_RULES = [
  choiceRules.optionCount({
    'multiple-choice': { min: MC_MIN_OPTIONS },
    'multiple-answer': { min: MC_MIN_OPTIONS },
  }),
  choiceRules.consecutiveKeys(),
];
const TEXT_RULES = [choiceRules.distinctText()];
const ANSWER_RULES = [choiceRules.correctCount(), choiceRules.feedbackOnIncorrect()];

// Throws for the first issue. A code with no override, including any a later
// release adds, throws the toolkit's own message.
function throwFirstIssue(issues, overrides = {}) {
  const [issue] = issues;
  if (!issue) return;
  const override = overrides[issue.code];
  throw new Error(override ? override() : issue.message);
}

function toChoiceOptions(keys, options, correctKeys) {
  return keys.map((key) => ({ key, ...options[key], correct: correctKeys.includes(key) }));
}

// The generated options, trimmed, once their semantics check out: at least
// MC_MIN_OPTIONS, lettered consecutively from A, no two alike.
//
// It reads rawOptions[key] (not optionAt, which differs when the model returns
// an array) and trims with || (not optionTextOf or optionFeedbackOf, which
// differ on bare-string options and feedback 0). The keys are checked before
// the text is read because String() throws on parsed JSON such as
// {"toString": 1}, and the model should still hear about the keys first.
function checkGeneratedOptions(type, rawOptions) {
  const trimOption = (opt) => ({
    text: String(opt?.text || '').trim(),
    feedback: String(opt?.feedback || '').trim(),
  });

  const keys = optionKeysOf(rawOptions);
  throwFirstIssue(checkChoice({ type, options: keys.map((key) => ({ key })) }, KEY_RULES));

  const options = Object.fromEntries(keys.map((key) => [key, trimOption(rawOptions[key])]));
  throwFirstIssue(checkChoice({ type, options: toChoiceOptions(keys, options, []) }, TEXT_RULES));
  return { keys, options };
}

function checkGeneratedMultipleChoiceOptions(rawOptions) {
  return checkGeneratedOptions('multiple-choice', rawOptions);
}

function checkGeneratedMultipleAnswerOptions(rawOptions) {
  return checkGeneratedOptions('multiple-answer', rawOptions);
}

function checkMultipleChoiceAnswer(keys, options, correctAnswer) {
  throwFirstIssue(
    checkChoice(
      { type: 'multiple-choice', options: toChoiceOptions(keys, options, [correctAnswer]) },
      ANSWER_RULES
    ),
    { 'choice.no-correct-option': () => `correctAnswer must be one of ${keys.join(', ')}.` }
  );
}

function checkMultipleAnswerAnswers(keys, options, correctAnswer) {
  throwFirstIssue(
    checkChoice(
      { type: 'multiple-answer', options: toChoiceOptions(keys, options, correctAnswer) },
      ANSWER_RULES
    ),
    { 'choice.no-correct-option': () => 'correctAnswers must list at least one correct option.' }
  );
}

module.exports = {
  checkGeneratedMultipleChoiceOptions,
  checkGeneratedMultipleAnswerOptions,
  checkMultipleChoiceAnswer,
  checkMultipleAnswerAnswers,
};
