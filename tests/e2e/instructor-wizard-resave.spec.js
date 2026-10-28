const { test, expect } = require('@playwright/test');
const { BIO_PROF2_AUTH_FILE } = require('./auth');
const { SEED } = require('./seed');
const { selectSeededCourse } = require('./helpers');

// Saving wizard questions again after "Add to Question Bank": only questions
// edited since their last save are re-sent, so changes made in the Question
// Bank in between survive. Opt-in (E2E_SAML=1).
const IDP_ENABLED = process.env.E2E_SAML === '1';

test.describe('Re-saving wizard questions (seeded course)', () => {
  test.skip(!IDP_ENABLED, 'Requires the SAML IdP - run with E2E_SAML=1');
  test.use({ storageState: BIO_PROF2_AUTH_FILE });
  test.setTimeout(120_000);

  async function throwawayObjective(page, courseId, label) {
    const name = `[[e2e-resave]] ${label} ${Date.now()}`;
    const response = await page.request.post('/api/objective', {
      data: {
        name,
        courseId,
        materialIds: [SEED.MATERIAL_SOURCE_ID], // generation needs a material
        granularObjectives: [{ text: `${name} granular` }],
      },
    });
    expect(response.ok(), `objective created (HTTP ${response.status()})`).toBe(true);
    const body = await response.json();
    return { id: String(body.objective._id), name, courseId };
  }

  // Clicks "Add to Question Bank" and closes the success dialog. Returns the
  // ids of any questions it created.
  async function addToBank(page) {
    const responses = [];
    const onResponse = (r) => {
      if (r.url().endsWith('/api/question/save') && r.request().method() === 'POST') {
        responses.push(r);
      }
    };
    page.on('response', onResponse);
    await page.getByRole('button', { name: 'Add to Question Bank' }).click();
    await expect(page.getByRole('dialog', { name: 'Questions Saved Successfully!' })).toBeVisible();
    page.off('response', onResponse);
    const created = [];
    for (const r of responses) {
      expect(r.ok()).toBe(true);
      created.push(...((await r.json()).questionIdsByIndex || []).filter(Boolean));
    }
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    return created;
  }

  // Generates two questions (one per Bloom level) for the objective with the
  // LLM stub, then adds them to the bank. Returns their bank ids.
  async function generateAndAddToBank(page, objective, { approveFirst = false } = {}) {
    await page.goto('/question-generation');
    await page.getByRole('button', { name: 'Add Existing Learning Objectives' }).click();
    await page.getByRole('checkbox', { name: objective.name, exact: true }).check();
    await page.getByRole('button', { name: 'Add 1 objective' }).click();
    await page.getByRole('button', { name: 'Remember', exact: true }).click();
    await page.getByRole('button', { name: 'Understand', exact: true }).click();
    await expect(page.getByText('Total questions to generate: 2')).toBeVisible();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('button', { name: 'Add to Quiz' })).toBeEnabled({
      timeout: 60_000,
    });

    if (approveFirst) {
      const toggles = page.getByRole('button', { name: 'Draft on save' });
      const count = await toggles.count();
      for (let i = 0; i < count; i++) await toggles.first().click();
      await expect(toggles).toHaveCount(0);
    }

    const ids = await addToBank(page);
    expect(ids).toHaveLength(2);
    return ids;
  }

  // Only one card is in edit mode at a time; its title is the header's field.
  async function editTitle(page, index, title) {
    await page.getByRole('button', { name: 'Edit' }).nth(index).click();
    const editingCard = page
      .locator('div.rounded-xl')
      .filter({ has: page.getByRole('button', { name: 'Save', exact: true }) })
      .last();
    await editingCard.getByLabel(/^(Question|Topic) title$/).fill(title);
    await editingCard.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Question updated successfully')).toBeVisible();
  }

  async function saveToNewQuiz(page, quizName) {
    await page.getByRole('button', { name: 'Add to Quiz' }).click();
    await page.getByPlaceholder('Enter quiz name...').fill(quizName);
    await page.getByRole('button', { name: 'Save to Quiz' }).click();
    const success = page.getByRole('dialog', { name: 'Questions Saved Successfully!' });
    await expect(success).toBeVisible();
    return success;
  }

  // Collects the URLs of question updates (PUTs) from here on.
  function recordQuestionPuts(page) {
    const puts = [];
    page.on('request', (r) => {
      if (r.method() === 'PUT' && r.url().includes('/api/question/')) puts.push(r.url());
    });
    return puts;
  }

  async function bankQuestion(page, id) {
    const response = await page.request.get(`/api/question/${id}`);
    expect(response.ok(), `question ${id} readable (HTTP ${response.status()})`).toBe(true);
    return (await response.json()).question;
  }

  async function expectOrphanedDraft(page, ids) {
    for (const id of ids) {
      const q = await bankQuestion(page, id);
      expect(q.orphaned, `${id} is orphaned`).toBe(true);
      expect(q.status, `${id} is Draft`).toBe('Draft');
    }
  }

  async function quizQuestionIds(page, courseId, quizName) {
    const quizzes = await (await page.request.get(`/api/quiz/course/${courseId}`)).json();
    const quiz = (quizzes.quizzes || []).find((q) => q.name === quizName);
    expect(quiz, `quiz "${quizName}" exists`).toBeTruthy();
    const listed = await (await page.request.get(`/api/quiz/${quiz._id}/questions`)).json();
    return (listed.questions || []).map((q) => String(q.id));
  }

  async function cleanUp(page, { objective, ids = [], quizName }) {
    if (quizName) {
      const quizzes = await page.request.get(`/api/quiz/course/${objective.courseId}`);
      if (quizzes.ok()) {
        for (const quiz of (await quizzes.json()).quizzes || []) {
          if (quiz.name === quizName) await page.request.delete(`/api/quiz/${quiz._id}`);
        }
      }
    }
    for (const id of ids) await page.request.delete(`/api/question/${id}`);
    await page.request.delete(`/api/objective/${objective.id}?questionAction=delete`);
  }

  test('questions orphaned by an objective delete stay orphaned and Draft on "Save to Quiz"', async ({
    page,
  }) => {
    const course = await selectSeededCourse(page, { role: 'instructor' });
    const objective = await throwawayObjective(page, course.id, 'orphan');
    const quizName = `[[e2e-resave]] orphan quiz ${Date.now()}`;
    let ids = [];

    try {
      ids = await generateAndAddToBank(page, objective, { approveFirst: true });
      expect((await bankQuestion(page, ids[0])).status).toBe('Approved');

      // Meanwhile: delete the objective, keeping its questions.
      const deleted = await page.request.delete(
        `/api/objective/${objective.id}?questionAction=keep`
      );
      expect(deleted.ok()).toBe(true);
      await expectOrphanedDraft(page, ids);

      // Nothing was edited, so nothing is re-sent; the quiz skips them.
      const puts = recordQuestionPuts(page);
      const success = await saveToNewQuiz(page, quizName);
      expect(puts).toEqual([]);
      await expect(success.getByText(/added 0 questions/)).toBeVisible();
      await expect(success.getByText('2 questions were skipped')).toBeVisible();
      await expectOrphanedDraft(page, ids);

      // Back to step 2 and "Add to Question Bank" again: still nothing sent.
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Back' }).click();
      expect(await addToBank(page)).toEqual([]);
      expect(puts).toEqual([]);
      await expectOrphanedDraft(page, ids);
    } finally {
      await cleanUp(page, { objective, ids, quizName });
    }
  });

  test('an approval made in the Question Bank survives "Save to Quiz"; page edits are saved', async ({
    page,
  }) => {
    const course = await selectSeededCourse(page, { role: 'instructor' });
    const objective = await throwawayObjective(page, course.id, 'approve');
    const quizName = `[[e2e-resave]] approve quiz ${Date.now()}`;
    let ids = [];

    try {
      ids = await generateAndAddToBank(page, objective);

      // Meanwhile: approve the first question in the Question Bank.
      const approved = await page.request.put(`/api/question/${ids[0]}/status`, {
        data: { status: 'Approved' },
      });
      expect(approved.ok()).toBe(true);

      const editedTitle = `Edited on the page ${Date.now()}`;
      await editTitle(page, 1, editedTitle);

      const puts = recordQuestionPuts(page);
      await saveToNewQuiz(page, quizName);

      // Only the edited question is re-sent, and nothing is duplicated.
      expect(puts).toEqual([expect.stringContaining(`/api/question/${ids[1]}`)]);
      expect((await bankQuestion(page, ids[0])).status).toBe('Approved');
      expect((await bankQuestion(page, ids[1])).title).toBe(editedTitle);
      expect((await quizQuestionIds(page, course.id, quizName)).sort()).toEqual([...ids].sort());
    } finally {
      await cleanUp(page, { objective, ids, quizName });
    }
  });

  test('a restored draft keeps an edit made after "Add to Question Bank"', async ({ page }) => {
    const course = await selectSeededCourse(page, { role: 'instructor' });
    const objective = await throwawayObjective(page, course.id, 'draft');
    const quizName = `[[e2e-resave]] draft quiz ${Date.now()}`;
    let ids = [];

    try {
      ids = await generateAndAddToBank(page, objective);

      const editedTitle = `Edited before reload ${Date.now()}`;
      await editTitle(page, 0, editedTitle);
      await page.reload();
      const prompt = page.getByRole('dialog', { name: 'Unsaved Questions Found' });
      await expect(prompt.getByText(/You have 1 question from/)).toBeVisible();
      await prompt.getByRole('button', { name: 'Continue Editing' }).click();
      await expect(page.getByText(editedTitle)).toBeVisible();

      await saveToNewQuiz(page, quizName);
      expect((await bankQuestion(page, ids[0])).title).toBe(editedTitle);
      expect((await quizQuestionIds(page, course.id, quizName)).sort()).toEqual([...ids].sort());

      // Everything is saved, so there is no draft to restore.
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Create Objectives' })).toBeVisible();
      await expect(prompt).toHaveCount(0);
    } finally {
      await cleanUp(page, { objective, ids, quizName });
    }
  });

  test('a question deleted from the Question Bank is saved again, even unchanged', async ({
    page,
  }) => {
    const course = await selectSeededCourse(page, { role: 'instructor' });
    const objective = await throwawayObjective(page, course.id, 'gone');
    const quizName = `[[e2e-resave]] gone quiz ${Date.now()}`;
    let ids = [];

    try {
      ids = await generateAndAddToBank(page, objective);
      expect((await page.request.delete(`/api/question/${ids[1]}`)).ok()).toBe(true);

      const success = await saveToNewQuiz(page, quizName);
      await expect(success.getByText(/added 2 questions/)).toBeVisible();

      const inQuiz = await quizQuestionIds(page, course.id, quizName);
      expect(inQuiz).toHaveLength(2);
      expect(inQuiz).toContain(ids[0]);
      expect(inQuiz).not.toContain(ids[1]);
      ids.push(inQuiz.find((id) => id !== ids[0])); // the re-created copy
    } finally {
      await cleanUp(page, { objective, ids, quizName });
    }
  });
});
