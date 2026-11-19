import { jest, describe, it, expect, beforeEach } from '@jest/globals';

// A generated multiple-answer question on its way from the generation API to
// a card, the save payload and the add-question wizard's form: its correct
// options stay a list of letters at every step.

const mockPost = jest.fn();
jest.unstable_mockModule('../../client/src/lib/api.js', () => ({
  api: { post: mockPost },
}));

const {
  generateQuestions,
  convertQuestionsToGroups,
  buildQuestionPayload,
  cardToWizardForm,
} = await import('../../client/src/pages/question-generation/generationApi.js');

const options = {
  A: { text: 'Neon', feedback: '' },
  B: { text: 'Nitrogen', feedback: 'Group 15.' },
  C: { text: 'Argon', feedback: '' },
  D: { text: 'Chlorine', feedback: 'A halogen.' },
};

const objectiveGroups = [
  {
    objectiveId: 'lo-1',
    title: 'Periodic table',
    materialIds: ['m-1'],
    items: [{ granularId: 'g-1', text: 'Identify noble gases', bloom: ['Remember'], count: 1 }],
  },
];

async function generatedCard() {
  mockPost.mockResolvedValue({
    success: true,
    questions: [
      {
        question: 'Which of these are noble gases?',
        questionType: 'multiple-answer',
        options,
        correctAnswer: ['A', 'C'],
        explanation: 'Group 18.',
      },
    ],
    tokenUsage: {},
  });
  const { questions } = await generateQuestions({ id: 'course-1', name: 'Chemistry' }, objectiveGroups);
  return convertQuestionsToGroups(questions)[0].los[0].questions[0];
}

describe('a generated multiple-answer question', () => {
  beforeEach(() => mockPost.mockReset());

  it('becomes a card whose prompt is the title and whose correct options are a list', async () => {
    const card = await generatedCard();
    expect(card).toMatchObject({
      questionType: 'multiple-answer',
      title: 'Which of these are noble gases?',
      stem: 'Which of these are noble gases?',
      correctAnswer: ['A', 'C'],
    });
    expect(Object.keys(card.options)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('saves with its type and correct letters', async () => {
    const payload = buildQuestionPayload(await generatedCard());
    expect(payload).toMatchObject({ questionType: 'multiple-answer', correctAnswer: ['A', 'C'] });
    expect(payload.options.B).toMatchObject({ text: 'Nitrogen', feedback: 'Group 15.' });
  });

  it('fills the wizard form with option rows and the correct letters', async () => {
    const form = cardToWizardForm(await generatedCard());
    expect(form.options.map((row) => [row.id, row.text])).toEqual([
      ['A', 'Neon'],
      ['B', 'Nitrogen'],
      ['C', 'Argon'],
      ['D', 'Chlorine'],
    ]);
    expect(form.correctAnswers).toEqual(['A', 'C']);
  });
});
