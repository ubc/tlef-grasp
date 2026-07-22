const { test, expect } = require('@playwright/test');
const { MongoClient } = require('mongodb');
const { BIO_PROF2_AUTH_FILE, BIO_STUDENT_AUTH_FILE } = require('./auth');
const { SEED } = require('./seed');
const { getQuizCard, selectSeededCourse, completeSeededQuiz } = require('./helpers');

const IDP_ENABLED = process.env.E2E_SAML === '1';

// Remove a quiz (and its question mappings + imported questions) created by the
// quiz-import test so re-runs stay clean.
async function deleteImportedQuiz(quizName, questionTitles) {
  const uri = process.env.MONGODB_URI;
  if (!uri) return;
  const client = new MongoClient(uri, { connectTimeoutMS: 8000 });
  await client.connect();
  try {
    const db = client.db(process.env.MONGODB_DB_NAME || undefined);
    const quizzes = await db.collection('grasp_quiz').find({ name: quizName }).toArray();
    for (const quiz of quizzes) {
      await db.collection('grasp_quiz_question').deleteMany({ quizId: quiz._id });
      await db.collection('grasp_quiz').deleteOne({ _id: quiz._id });
    }
    await db.collection('grasp_question').deleteMany({ title: { $in: questionTitles } });
  } finally {
    await client.close();
  }
}

test.describe('Instructor seeded course management (authenticated)', () => {
  test.skip(!IDP_ENABLED, 'Requires the SAML IdP - run with E2E_SAML=1');
  test.use({ storageState: BIO_PROF2_AUTH_FILE });

  test('shows the seeded linked section without changing it', async ({ page }) => {
    await selectSeededCourse(page, { role: 'instructor' });
    await page.goto('/my-sections');

    await expect(
      page.getByRole('heading', { name: 'My Sections' })
    ).toBeVisible();
    await expect(page.getByRole('main').getByText(SEED.COURSE_NAME)).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Linked sections' })
    ).toBeVisible();
    await expect(page.getByRole('cell', { name: '101' })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Sync Students' })
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Recycle' })).toBeVisible();
  });

  test('shows the seeded quiz approval and active section schedule', async ({
    page,
  }) => {
    await selectSeededCourse(page, { role: 'instructor' });
    await page.goto('/quizzes');

    await expect(
      page.getByRole('button', { name: 'Manage Quizzes' })
    ).toBeVisible();
    const quizCard = getQuizCard(page, SEED.QUIZ_NAME);
    await expect(quizCard).toBeVisible();
    await expect(quizCard.getByText('100% Approved')).toBeVisible();
    await expect(quizCard.getByText('Section schedule')).toBeVisible();
    await expect(quizCard.getByRole('button', { name: /101\s+Active/ })).toBeVisible();
    await expect(
      quizCard.getByRole('checkbox', { name: /Disable previous question/ })
    ).not.toBeChecked();
    await expect(quizCard.getByRole('button', { name: 'Unpublish' })).toBeVisible();
  });

  test('exports the seeded quiz to JSON with objectives and quiz settings', async ({
    page,
  }) => {
    await selectSeededCourse(page, { role: 'instructor' });
    await page.goto('/quizzes');

    const quizCard = getQuizCard(page, SEED.QUIZ_NAME);
    await expect(quizCard).toBeVisible();
    await quizCard.getByRole('button', { name: 'Export' }).click();

    const dialog = page.getByRole('dialog', { name: 'Export Quiz' });
    await expect(dialog).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await dialog.getByRole('button', { name: /JSON/ }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.json$/);

    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf-8'));

    // Quiz-level settings are carried so the file can be re-imported (Phase 4).
    expect(parsed.quiz).toBeTruthy();
    expect(parsed.quiz.name).toBe(SEED.QUIZ_NAME);
    expect(parsed.quiz.deliveryFormat).toBe('all-approved');
    expect(parsed.quiz.description).toContain('Seeded quiz');

    // The objectives summary and per-question links are present.
    const metaNames = parsed.objectives.map((o) => o.metaObjectiveName);
    expect(metaNames).toContain(SEED.OBJECTIVE_NAME);
    expect(parsed.questions.length).toBeGreaterThan(0);
    for (const question of parsed.questions) {
      expect(question).toHaveProperty('learningObjectiveName');
      expect(question).toHaveProperty('granularObjectiveName');
    }
  });

  test('imports a whole quiz from JSON, restoring its settings and questions', async ({
    page,
  }) => {
    const stamp = Date.now();
    const quizName = `[[e2e-import]] Imported Quiz ${stamp}`;
    const questionTitle = `[[e2e-import]] Imported quiz MC ${stamp}`;
    const importFile = {
      course: 'ignored-on-import',
      quiz: {
        name: quizName,
        description: 'Imported via e2e',
        deliveryFormat: 'all-approved',
        disablePreviousNavigation: false,
        timeLimitMinutes: 42,
        published: false,
      },
      questions: [
        {
          title: questionTitle,
          stem: 'Select the best answer:',
          questionType: 'multiple-choice',
          options: {
            A: { text: 'Correct choice', feedback: '' },
            B: { text: 'Wrong', feedback: '' },
            C: { text: 'Wrong', feedback: '' },
            D: { text: 'Wrong', feedback: '' },
          },
          correctAnswer: 'A',
          bloom: 'Understand',
          status: 'Approved',
          granularObjectiveName: SEED.GRANULAR_NAME,
          learningObjectiveName: SEED.OBJECTIVE_NAME,
        },
      ],
    };

    try {
      await selectSeededCourse(page, { role: 'instructor' });
      await page.goto('/quizzes');
      await page.getByRole('button', { name: 'Create New Quiz' }).click();

      // The wizard opens on a build-or-import choice.
      await expect(
        page.getByRole('heading', { name: 'Create a New Quiz' })
      ).toBeVisible();
      await page.getByRole('button', { name: 'Import a Quiz' }).click();
      await expect(page.getByRole('heading', { name: 'Import a Quiz' })).toBeVisible();

      await page.locator('input[type="file"]').setInputFiles({
        name: `quiz-${stamp}.json`,
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(importFile)),
      });

      // The quiz name is prefilled and the restored settings are shown.
      await expect(page.getByLabel('Quiz Name')).toHaveValue(quizName);
      await expect(page.getByText(/Restored settings: 42 min/)).toBeVisible();

      // The single question matched the seeded objective by name, so import is
      // immediately allowed.
      const importButton = page.getByRole('button', { name: /Import Quiz/ });
      await expect(importButton).toBeEnabled();
      await importButton.click();

      await expect(page.getByText(/Imported quiz with 1 question/)).toBeVisible();

      // The new quiz shows in Manage Quizzes.
      await expect(getQuizCard(page, quizName)).toBeVisible();
    } finally {
      await deleteImportedQuiz(quizName, [questionTitle]);
    }
  });

  test('shows section schedule events on the dashboard calendar', async ({ page }) => {
    await selectSeededCourse(page, { role: 'instructor' });
    await page.goto('/dashboard');

    const calendar = page.getByLabel('Quiz calendar');
    const eventDays = calendar.getByRole('button', { name: /quiz events?/ });
    await expect(eventDays.first()).toBeVisible();
    const eventDayCount = await eventDays.count();
    for (let index = 0; index < eventDayCount; index += 1) {
      await eventDays.nth(index).click();
      if (await calendar.getByText(SEED.QUIZ_NAME).count()) break;
    }

    const quizEvent = calendar.locator('li').filter({ hasText: SEED.QUIZ_NAME });
    await expect(quizEvent).toContainText('101');
    await quizEvent.getByRole('link', { name: 'Manage schedule' }).click();

    await expect(page).toHaveURL(/\/quizzes\?quiz=/);
    await expect(getQuizCard(page, SEED.QUIZ_NAME)).toBeVisible();
  });

  test('reviews a real student attempt in Quiz Scores', async ({
    browser,
    page,
    baseURL,
  }) => {
    const studentContext = await browser.newContext({
      baseURL,
      storageState: BIO_STUDENT_AUTH_FILE,
    });
    try {
      const studentPage = await studentContext.newPage();
      await selectSeededCourse(studentPage, { role: 'student' });
      await completeSeededQuiz(studentPage);
    } finally {
      await studentContext.close();
    }

    await selectSeededCourse(page, { role: 'instructor' });
    await page.goto('/quiz-scores');

    await expect(
      page.getByRole('heading', { name: 'Quiz Scores' })
    ).toBeVisible();
    await page
      .getByRole('main')
      .getByRole('combobox')
      .first()
      .selectOption({ label: SEED.QUIZ_NAME });

    const completedRow = page.getByRole('row').filter({ hasText: '100.0%' }).first();
    await expect(completedRow).toBeVisible();
    await expect(completedRow.getByText(`${SEED.QUESTION_COUNT} / ${SEED.QUESTION_COUNT}`)).toBeVisible();
    await completedRow.click();

    const reviewDialog = page.getByRole('dialog', { name: /Review:/ });
    await expect(reviewDialog).toBeVisible();
    await expect(reviewDialog).toContainText(/Score:\s*100\.0%/);
    await expect(reviewDialog).toContainText(
      `Correct: ${SEED.QUESTION_COUNT} / ${SEED.QUESTION_COUNT}`
    );
    await expect(reviewDialog.getByText(SEED.CORRECT_OPTION_TEXTS[0])).toBeVisible();
  });
});
