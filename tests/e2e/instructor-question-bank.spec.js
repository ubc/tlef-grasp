const { test, expect } = require('@playwright/test');
const { MongoClient } = require('mongodb');
const { BIO_PROF2_AUTH_FILE } = require('./auth');
const { SEED, seedStudentJourneyCourse } = require('./seed');
const { selectSeededCourse } = require('./helpers');

// Remove questions created by the import test so re-runs stay clean.
async function deleteQuestionsByTitle(titles) {
  const uri = process.env.MONGODB_URI;
  if (!uri) return;
  const client = new MongoClient(uri, { connectTimeoutMS: 8000 });
  await client.connect();
  try {
    await client
      .db(process.env.MONGODB_DB_NAME || undefined)
      .collection('grasp_question')
      .deleteMany({ title: { $in: titles } });
  } finally {
    await client.close();
  }
}

// Question Bank browsing for bio_prof2 against the seeded BIOC 302 course:
// the questions table, its search/status filters, single-question flagging,
// and the Learning Objectives tab. Bulk approval is exercised by the
// instructor journey; this spec covers the read/filter surface the journey
// skips. Opt-in (E2E_SAML=1).
const IDP_ENABLED = process.env.E2E_SAML === '1';

test.describe('Instructor question bank (seeded course)', () => {
  test.skip(!IDP_ENABLED, 'Requires the SAML IdP - run with E2E_SAML=1');
  test.use({ storageState: BIO_PROF2_AUTH_FILE });

  test('lists the seeded questions as approved with their objective', async ({
    page,
  }) => {
    await selectSeededCourse(page, { role: 'instructor' });
    await page.goto('/question-bank');

    // The hardcoded notification bell was removed (issue #27). Exact match
    // targets the round Settings icon (aria-label "Settings"), not the
    // "  Settings" nav row.
    await expect(page.getByRole('button', { name: 'Notifications' })).toHaveCount(0);
    await expect(
      page.getByRole('link', { name: 'Settings', exact: true })
    ).toBeVisible();

    // The local database can contain other approved questions in this course.
    // Scope count assertions to the original seeded quiz rather than assuming
    // the course's entire question bank contains only seed data.
    await page.getByLabel('Quiz').selectOption({ label: SEED.QUIZ_NAME });

    for (const title of SEED.QUESTION_TITLES) {
      await expect(page.getByRole('cell', { name: title })).toBeVisible();
    }
    // Every seeded question is Approved. Cell-scoped so the identical entries
    // in the filter dropdowns don't match.
    await expect(page.getByRole('cell', { name: 'Approved' })).toHaveCount(
      SEED.QUESTION_COUNT
    );
    // The "Associated GLO" column shows the PARENT objective name, which the
    // backend derives from each question's granularObjectiveId
    // (getQuestionsByCourseId maps granular → parent), not the granular text.
    await expect(
      page.getByRole('cell', { name: SEED.OBJECTIVE_NAME })
    ).toHaveCount(SEED.QUESTION_COUNT);
  });

  test('search narrows the table to matching questions', async ({ page }) => {
    await selectSeededCourse(page, { role: 'instructor' });
    await page.goto('/question-bank');
    await page.getByLabel('Quiz').selectOption({ label: SEED.QUIZ_NAME });
    await expect(
      page.getByRole('cell', { name: SEED.QUESTION_TITLES[0] })
    ).toBeVisible();

    await page
      .getByPlaceholder('Search questions...')
      .fill('Michaelis constant');

    await expect(
      page.getByRole('cell', { name: SEED.QUESTION_TITLES[0] })
    ).toBeVisible();
    await expect(
      page.getByRole('cell', { name: SEED.QUESTION_TITLES[1] })
    ).toBeHidden();
  });

  test('status filter hides questions of other statuses', async ({ page }) => {
    await selectSeededCourse(page, { role: 'instructor' });
    await page.goto('/question-bank');
    await expect(
      page.getByRole('cell', { name: SEED.QUESTION_TITLES[0] })
    ).toBeVisible();

    // Other local course questions may be drafts; the seeded Approved rows must
    // still disappear when the Draft filter is selected.
    await page.getByLabel('Status').selectOption('Draft');
    await expect(
      page.getByRole('cell', { name: SEED.QUESTION_TITLES[0] })
    ).toBeHidden();

    await page.getByLabel('Status').selectOption('Approved');
    await expect(
      page.getByRole('cell', { name: SEED.QUESTION_TITLES[0] })
    ).toBeVisible();
  });

  test('adds a valid existing course question to a quiz and lists available questions first', async ({
    page,
  }) => {
    // Reset the shared quiz before and after this write-producing test so no
    // other seeded journey inherits the added question.
    await seedStudentJourneyCourse();
    try {
      await selectSeededCourse(page, { role: 'instructor' });
      await page.goto('/question-bank');
      await page.getByLabel('Quiz').selectOption({ label: SEED.QUIZ_NAME });

      await page.getByRole('button', { name: 'Add Existing Questions' }).click();
      const dialog = page.getByRole('dialog', {
        name: `Add existing questions to ${SEED.QUIZ_NAME}`,
      });
      await expect(dialog).toBeVisible();

      const questionCards = dialog.locator('label:has(input[type="checkbox"])');
      const availableCard = questionCards.filter({ hasText: SEED.AI_OPEN_ENDED_TITLE });
      const alreadyAddedCard = questionCards.filter({ hasText: SEED.QUESTION_TITLES[0] });
      await expect(availableCard.getByRole('checkbox')).toBeEnabled();
      await expect(alreadyAddedCard.getByRole('checkbox')).toBeDisabled();

      const availableIndex = await availableCard.evaluate((card) =>
        Array.from(card.parentElement.children).indexOf(card)
      );
      const alreadyAddedIndex = await alreadyAddedCard.evaluate((card) =>
        Array.from(card.parentElement.children).indexOf(card)
      );
      expect(availableIndex).toBeLessThan(alreadyAddedIndex);

      await availableCard.getByRole('checkbox').check();
      await dialog.getByRole('button', { name: 'Add 1 question' }).click();
      await expect(page.getByText('Added 1 question to the quiz')).toBeVisible();
      await expect(dialog).toBeHidden();
      await expect(page.getByRole('cell', { name: SEED.AI_OPEN_ENDED_TITLE })).toBeVisible();
    } finally {
      await seedStudentJourneyCourse();
    }
  });

  test('flags a question and finds it with the flagged-only filter', async ({
    page,
  }) => {
    await selectSeededCourse(page, { role: 'instructor' });
    await page.goto('/question-bank');

    // The row action buttons reveal on hover.
    const firstTitleCell = page.getByRole('cell', {
      name: SEED.QUESTION_TITLES[0],
    });
    await firstTitleCell.hover();
    // The button's accessible name carries the FontAwesome glyph as a prefix,
    // so match the end of the name. /Flag$/ (case-sensitive) hits "Flag" but
    // not "Unflag" (which ends in lowercase "flag").
    await firstTitleCell.getByRole('button', { name: /Flag$/ }).click();
    await expect(page.getByText('Question flagged successfully')).toBeVisible();

    // A flagged question exposes an optional reason field with an explicit save
    // action, so instructors do not need to click outside the field to persist it.
    const reasonPlaceholder =
      'Add a note explaining why this question is flagged…';
    const reasonBox = firstTitleCell.getByPlaceholder(reasonPlaceholder);
    await expect(reasonBox).toBeVisible();
    await reasonBox.fill('Answer key looks wrong');
    await firstTitleCell
      .getByRole('button', {
        name: `Save flag reason for ${SEED.QUESTION_TITLES[0]}`,
      })
      .click();
    await expect(page.getByText('Flag reason saved')).toBeVisible();

    // The saved reason survives a reload.
    await page.reload();
    await expect(page.getByPlaceholder(reasonPlaceholder)).toHaveValue(
      'Answer key looks wrong'
    );

    // The flagged-only filter keeps just the flagged question.
    await page.getByRole('checkbox', { name: 'Show flagged only' }).check();
    await expect(firstTitleCell).toBeVisible();
    await expect(
      page.getByRole('cell', { name: SEED.QUESTION_TITLES[1] })
    ).toBeHidden();

    // Unflag to restore the seeded state; the filtered view empties.
    await firstTitleCell.hover();
    await firstTitleCell.getByRole('button', { name: /Unflag$/ }).click();
    await expect(
      page.getByText('Question unflagged successfully')
    ).toBeVisible();
    await expect(page.getByText('No questions available.')).toBeVisible();

    await page.getByRole('checkbox', { name: 'Show flagged only' }).uncheck();
    await expect(firstTitleCell).toBeVisible();
  });

  test('exports selected questions to CSV carrying the objective columns', async ({
    page,
  }) => {
    await selectSeededCourse(page, { role: 'instructor' });
    await page.goto('/question-bank');
    // Scope to the seeded quiz so "select all" picks up only seeded rows, not
    // other approved questions the local course may hold.
    await page.getByLabel('Quiz').selectOption({ label: SEED.QUIZ_NAME });
    await expect(
      page.getByRole('cell', { name: SEED.QUESTION_TITLES[0] })
    ).toBeVisible();

    await page.getByLabel('Select all questions').check();

    await page.getByRole('button', { name: /Export$/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Export Questions' });
    await expect(dialog).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await dialog.getByRole('button', { name: /CSV/ }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.csv$/);

    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const content = Buffer.concat(chunks).toString('utf-8');

    // The four objective columns are present in the header...
    expect(content).toContain('Meta Learning Objective');
    expect(content).toContain('Granular Learning Objective');
    expect(content).toContain('Meta LO ID');
    expect(content).toContain('Granular LO ID');
    // ...and the seeded questions carry their resolved objective names, with the
    // meta (parent) and granular objectives in separate columns.
    expect(content).toContain(SEED.OBJECTIVE_NAME);
    expect(content).toContain(SEED.GRANULAR_NAME);

    await expect(page.getByText(/Exported \d+ question/)).toBeVisible();
  });

  test('imports questions from JSON, gating each on a course objective', async ({
    page,
  }) => {
    const stamp = Date.now();
    const matchedTitle = `[[e2e-import]] Auto-matched MC ${stamp}`;
    const unmatchedTitle = `[[e2e-import]] Needs-objective FIB ${stamp}`;
    // Two questions: the first names the seeded granular objective (matched by
    // name), the second names an objective that doesn't exist here (must be
    // assigned before import is allowed).
    const importFile = {
      course: 'ignored-on-import',
      questions: [
        {
          title: matchedTitle,
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
          granularObjectiveId: 'deadbeefdeadbeefdeadbeef',
          granularObjectiveName: SEED.GRANULAR_NAME,
          learningObjectiveName: SEED.OBJECTIVE_NAME,
        },
        {
          title: unmatchedTitle,
          stem: 'The ______ has no matching objective.',
          questionType: 'fill-in-the-blank',
          correctAnswer: 'blank',
          acceptableAnswers: ['blank'],
          bloom: 'Remember',
          granularObjectiveId: 'ffffffffffffffffffffffff',
          granularObjectiveName: 'A Totally Unknown Objective 9Z',
        },
      ],
    };

    try {
      await selectSeededCourse(page, { role: 'instructor' });
      await page.goto('/question-bank');

      await page.getByRole('button', { name: 'Add New Question' }).click();
      const choice = page.getByRole('dialog', { name: 'Add Questions' });
      await expect(choice).toBeVisible();
      await choice.getByRole('button', { name: 'Import Questions' }).click();

      const dialog = page.getByRole('dialog', { name: 'Import Questions' });
      await expect(dialog).toBeVisible();

      await dialog.locator('input[type="file"]').setInputFiles({
        name: `import-${stamp}.json`,
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(importFile)),
      });

      // Both rows render; one is matched, one still needs an objective, so the
      // import button is gated.
      await expect(dialog.getByText(matchedTitle)).toBeVisible();
      await expect(dialog.getByText(unmatchedTitle)).toBeVisible();
      await expect(dialog.getByText(/1 question.*need/)).toBeVisible();
      const importButton = dialog.getByRole('button', { name: /Import 2 questions/ });
      await expect(importButton).toBeDisabled();

      // Assign the seeded objective to the unmatched question; import unlocks.
      await dialog
        .getByLabel('Learning objective for question 2')
        .selectOption({ label: SEED.GRANULAR_NAME });
      await expect(importButton).toBeEnabled();

      await importButton.click();
      await expect(page.getByText('Imported 2 questions')).toBeVisible();
      await expect(dialog).toBeHidden();

      // The imported questions now appear in the bank.
      await expect(page.getByRole('cell', { name: matchedTitle })).toBeVisible();
      await expect(page.getByRole('cell', { name: unmatchedTitle })).toBeVisible();

      // Re-importing the very same file must not create duplicates: the first
      // question already matches an objective, so it is rejected as a duplicate.
      await page.getByRole('button', { name: 'Add New Question' }).click();
      await page
        .getByRole('dialog', { name: 'Add Questions' })
        .getByRole('button', { name: 'Import Questions' })
        .click();
      const reDialog = page.getByRole('dialog', { name: 'Import Questions' });
      await reDialog.locator('input[type="file"]').setInputFiles({
        name: `reimport-${stamp}.json`,
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify({ questions: [importFile.questions[0]] })),
      });
      await reDialog
        .getByRole('button', { name: /Import 1 question/ })
        .click();
      await expect(page.getByText(/already exist/i)).toBeVisible();
      // Still exactly one copy of the matched question in the bank.
      await expect(page.getByRole('cell', { name: matchedTitle })).toHaveCount(1);
    } finally {
      await deleteQuestionsByTitle([matchedTitle, unmatchedTitle]);
    }
  });

  test('learning objectives tab shows the seeded objective hierarchy', async ({
    page,
  }) => {
    await selectSeededCourse(page, { role: 'instructor' });
    await page.goto('/question-bank');

    await page.getByRole('button', { name: 'Learning Objectives' }).click();

    await expect(
      page.getByRole('heading', { name: SEED.OBJECTIVE_NAME })
    ).toBeVisible();
    await expect(page.getByText(SEED.GRANULAR_NAME)).toBeVisible();
  });
});
