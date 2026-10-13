// Which question types each AI path may name. Multiple answer is a question
// type but objective generation never recommends it: instructors add it
// themselves, so the AI's suggested mix stays as it was before the type
// existed.

const {
  QUESTION_TYPES,
  GENERATED_QUESTION_TYPES,
  SUGGESTED_QUESTION_TYPES,
} = require('../../src/constants/app-constants');
const { OBJECTIVES_SCHEMA } = require('../../src/constants/llm-schemas');
const { normalizeQuestionTypes } = require('../../src/utils/question-type-selection');

const schemaQuestionTypes = () =>
  OBJECTIVES_SCHEMA.properties.objectives.items.properties.granularObjectives.items
    .properties.questionTypes.items.properties.questionType.enum;

describe('question type lists', () => {
  it('lets objective generation suggest only the types it suggested before multiple answer', () => {
    expect(schemaQuestionTypes()).toEqual(SUGGESTED_QUESTION_TYPES);
    expect(SUGGESTED_QUESTION_TYPES).toEqual([
      QUESTION_TYPES.MULTIPLE_CHOICE,
      QUESTION_TYPES.FILL_IN_THE_BLANK,
      QUESTION_TYPES.CALCULATION,
      QUESTION_TYPES.OPEN_ENDED,
    ]);
  });

  it('does not ask AI generation for multiple answer yet', () => {
    expect(GENERATED_QUESTION_TYPES).not.toContain(QUESTION_TYPES.MULTIPLE_ANSWER);
    expect(
      normalizeQuestionTypes([
        { bloomLevel: 'Understand', questionType: QUESTION_TYPES.MULTIPLE_ANSWER, count: 2 },
        { bloomLevel: 'Understand', questionType: QUESTION_TYPES.MULTIPLE_CHOICE, count: 1 },
      ])
    ).toEqual([{ bloomLevel: 'Understand', questionType: QUESTION_TYPES.MULTIPLE_CHOICE, count: 1 }]);
  });
});
