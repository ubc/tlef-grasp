const { answerSignature, findDuplicateQuestion } = require('../../src/services/question');
const { QUESTION_TYPES } = require('../../src/constants/app-constants');

describe('answerSignature', () => {
  test('multiple-choice ignores whitespace and casing in options', () => {
    const a = {
      questionType: QUESTION_TYPES.MULTIPLE_CHOICE,
      options: { A: { text: 'Carbon Dioxide' }, B: { text: 'Oxygen' } },
      correctAnswer: 'A',
    };
    const b = {
      questionType: QUESTION_TYPES.MULTIPLE_CHOICE,
      options: { A: { text: '  carbon   dioxide ' }, B: { text: 'OXYGEN' } },
      correctAnswer: 'a',
    };
    expect(answerSignature(a)).toBe(answerSignature(b));
  });

  test('multiple-choice differs when the correct answer differs', () => {
    const base = {
      questionType: QUESTION_TYPES.MULTIPLE_CHOICE,
      options: { A: { text: 'x' }, B: { text: 'y' } },
    };
    expect(answerSignature({ ...base, correctAnswer: 'A' })).not.toBe(
      answerSignature({ ...base, correctAnswer: 'B' })
    );
  });

  test('multiple-choice differs when an option text differs', () => {
    const a = {
      questionType: QUESTION_TYPES.MULTIPLE_CHOICE,
      options: { A: { text: 'x' }, B: { text: 'y' } },
      correctAnswer: 'A',
    };
    const b = {
      questionType: QUESTION_TYPES.MULTIPLE_CHOICE,
      options: { A: { text: 'x' }, B: { text: 'z' } },
      correctAnswer: 'A',
    };
    expect(answerSignature(a)).not.toBe(answerSignature(b));
  });

  test('handles string-form options', () => {
    const obj = {
      questionType: QUESTION_TYPES.MULTIPLE_CHOICE,
      options: { A: { text: 'hello' } },
      correctAnswer: 'A',
    };
    const str = {
      questionType: QUESTION_TYPES.MULTIPLE_CHOICE,
      options: { A: 'hello' },
      correctAnswer: 'A',
    };
    expect(answerSignature(obj)).toBe(answerSignature(str));
  });

  test('fill-in-the-blank compares acceptable answers order-insensitively', () => {
    const a = {
      questionType: QUESTION_TYPES.FILL_IN_THE_BLANK,
      correctAnswer: 'mitochondrion',
      acceptableAnswers: ['mitochondria', 'mitochondrion'],
    };
    const b = {
      questionType: QUESTION_TYPES.FILL_IN_THE_BLANK,
      correctAnswer: 'Mitochondrion',
      acceptableAnswers: ['MITOCHONDRION', 'mitochondria'],
    };
    expect(answerSignature(a)).toBe(answerSignature(b));
  });
});

// findDuplicateQuestion takes a db handle; a tiny fake collection lets us test
// the matching without a live Mongo.
function fakeDb(existing) {
  return {
    collection() {
      return {
        find() {
          return { toArray: async () => existing };
        },
      };
    },
  };
}

describe('findDuplicateQuestion', () => {
  const granularId = 'gran-1';
  const existing = [
    {
      title: 'Which gas do plants absorb?',
      stem: 'Select the best answer:',
      questionType: QUESTION_TYPES.MULTIPLE_CHOICE,
      options: { A: { text: 'Carbon dioxide' }, B: { text: 'Oxygen' } },
      correctAnswer: 'A',
    },
  ];

  test('flags a same-text, same-options, same-objective question as duplicate', async () => {
    const incoming = {
      title: '  which GAS do plants absorb? ',
      stem: 'select the best answer:',
      questionType: QUESTION_TYPES.MULTIPLE_CHOICE,
      options: { A: { text: 'carbon dioxide' }, B: { text: 'oxygen' } },
      correctAnswer: 'a',
    };
    const dup = await findDuplicateQuestion(fakeDb(existing), 'course', granularId, incoming);
    expect(dup).not.toBeNull();
  });

  test('does not flag when the question text differs', async () => {
    const incoming = {
      title: 'Which gas do plants release?',
      stem: 'Select the best answer:',
      questionType: QUESTION_TYPES.MULTIPLE_CHOICE,
      options: { A: { text: 'Carbon dioxide' }, B: { text: 'Oxygen' } },
      correctAnswer: 'A',
    };
    const dup = await findDuplicateQuestion(fakeDb(existing), 'course', granularId, incoming);
    expect(dup).toBeNull();
  });

  test('does not flag when the options differ', async () => {
    const incoming = {
      title: 'Which gas do plants absorb?',
      stem: 'Select the best answer:',
      questionType: QUESTION_TYPES.MULTIPLE_CHOICE,
      options: { A: { text: 'Nitrogen' }, B: { text: 'Oxygen' } },
      correctAnswer: 'A',
    };
    const dup = await findDuplicateQuestion(fakeDb(existing), 'course', granularId, incoming);
    expect(dup).toBeNull();
  });
});
