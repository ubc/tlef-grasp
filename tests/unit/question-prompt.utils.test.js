// The question-text rule (issue #223). The cases are shared with the client
// copy in client/src/lib/questionPrompt.js (tests/client/question-prompt.test.mjs).
const cases = require('../fixtures/question-prompt-cases.json');
const { promptOf, isGenericStem } = require('../../src/utils/question-prompt');

describe('promptOf', () => {
  test.each(cases.promptOf.map((c) => [c.name, c]))('%s', (_name, { question, expected }) => {
    expect(promptOf(question)).toBe(expected);
  });
});

describe('isGenericStem', () => {
  test.each(cases.isGenericStem.map((c) => [JSON.stringify(c.stem), c]))('%s', (_stem, { stem, expected }) => {
    expect(isGenericStem(stem)).toBe(expected);
  });
});
