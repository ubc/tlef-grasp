const { test, expect } = require('@playwright/test');
const { MongoClient, ObjectId } = require('mongodb');
const { BIO_PROF2_AUTH_FILE } = require('./auth');
const { SEED, seedStudentJourneyCourse } = require('./seed');
const { selectSeededCourse } = require('./helpers');

// An edit that would make a question identical to another one under the same
// learning objective is refused, and the instructor is told so in a popup
// they close to get back to the question. bio_prof2 meets it twice against the
// seeded BIOC 302 objective: editing one question's title to match another,
// and re-attaching an orphan to the objective that already holds its copy.
// Opt-in (E2E_SAML=1).
const IDP_ENABLED = process.env.E2E_SAML === '1';

async function withDb(fn) {
  const client = new MongoClient(process.env.MONGODB_URI, { connectTimeoutMS: 8000 });
  await client.connect();
  try {
    return await fn(client.db(process.env.MONGODB_DB_NAME || undefined));
  } finally {
    await client.close();
  }
}

// Insert multiple-choice questions under the seeded granular objective; each
// override is merged into the shared content.
async function insertQuestions(overrides) {
  return withDb(async (db) => {
    const course = await db.collection('grasp_course').findOne({ courseCode: SEED.COURSE_CODE });
    const granular = await db
      .collection('grasp_objective')
      .findOne({ courseId: course._id, name: SEED.GRANULAR_NAME });
    const now = new Date();
    const docs = overrides.map((override) => ({
      courseId: course._id,
      granularObjectiveId: granular._id,
      learningObjectiveId: granular.parent,
      questionType: 'multiple-choice',
      stem: 'Select the best answer:',
      options: {
        A: { text: 'It rises', feedback: '' },
        B: { text: 'It falls', feedback: '' },
      },
      correctAnswer: 'A',
      bloom: 'Understand',
      status: 'Draft',
      createdAt: now,
      updatedAt: now,
      ...override,
    }));
    await db.collection('grasp_question').insertMany(docs);
    return docs;
  });
}

const findQuestion = (id) => withDb((db) => db.collection('grasp_question').findOne({ _id: id }));

const deleteQuestions = (marker) =>
  withDb((db) => db.collection('grasp_question').deleteMany({ title: { $regex: marker } }));

test.describe('Instructor is told about a duplicate question in a popup', () => {
  test.skip(!IDP_ENABLED, 'Requires the SAML IdP - run with E2E_SAML=1');
  test.use({ storageState: BIO_PROF2_AUTH_FILE });

  test.beforeAll(async () => {
    await seedStudentJourneyCourse();
  });

  test('editing a question to match another keeps the edit dialog open behind the popup', async ({
    page,
  }) => {
    const marker = `Duplicate check ${Date.now()}`;
    const original = `${marker}: what happens to Km?`;
    const [, copy] = await insertQuestions([
      { title: original },
      { title: `${marker}: what happens to Vmax?` },
    ]);

    try {
      await selectSeededCourse(page, { role: 'instructor' });
      await page.goto('/question-bank');
      await page.getByPlaceholder('Search questions...').fill(marker);
      await page
        .getByRole('row')
        .filter({ hasText: 'Vmax' })
        .getByRole('button', { name: 'View/Edit' })
        .click();

      const dialog = page.getByRole('dialog', { name: 'Edit question' });
      await dialog.getByLabel('Question Title').fill(original);
      await dialog.getByRole('button', { name: 'Save Changes' }).click();

      const popup = page.getByRole('dialog', { name: 'Duplicate detected' });
      await expect(popup).toBeVisible();
      await expect(popup).toContainText('already has an identical question');

      // Escape closes only the popup; the edit, unsaved, is still there.
      await page.keyboard.press('Escape');
      await expect(popup).toBeHidden();
      await expect(dialog).toBeVisible();
      await expect(dialog.getByLabel('Question Title')).toHaveValue(original);

      await dialog.getByRole('button', { name: 'Save Changes' }).click();
      await popup.getByRole('button', { name: 'Back to editing' }).click();
      await expect(popup).toBeHidden();
      await expect(dialog).toBeVisible();
      expect((await findQuestion(copy._id)).title).toBe(copy.title);

      // Changing the question so it differs saves as normal.
      await dialog.getByLabel('Question Title').fill(`${marker}: what happens to kcat?`);
      await dialog.getByRole('button', { name: 'Save Changes' }).click();
      await expect(page.getByText('Question updated successfully')).toBeVisible();
      await expect(dialog).toBeHidden();
      expect((await findQuestion(copy._id)).title).toBe(`${marker}: what happens to kcat?`);
    } finally {
      await deleteQuestions(marker);
    }
  });

  test('re-attaching an orphan to the objective holding its copy is refused in a popup', async ({
    page,
  }) => {
    const marker = `Duplicate orphan ${Date.now()}`;
    const title = `${marker}: what happens to Km?`;
    const [, orphan] = await insertQuestions([
      { title },
      {
        title,
        // Its objective was deleted and the question kept.
        granularObjectiveId: new ObjectId(),
        orphaned: true,
        orphanedAt: new Date(),
      },
    ]);

    try {
      await selectSeededCourse(page, { role: 'instructor' });
      await page.goto('/question-bank');
      await page.getByPlaceholder('Search questions...').fill(marker);
      await page.getByRole('button', { name: 'Attach objective' }).click();

      const attach = page.getByRole('dialog', { name: 'Attach Learning Objective' });
      await attach.getByRole('combobox').selectOption({ label: SEED.GRANULAR_NAME });
      await attach.getByRole('button', { name: 'Attach & restore' }).click();

      const popup = page.getByRole('dialog', { name: 'Duplicate detected' });
      await expect(popup).toBeVisible();
      await expect(popup).toContainText('already has an identical question');
      await popup.getByRole('button', { name: 'OK' }).click();
      await expect(popup).toBeHidden();

      const stillOrphaned = await findQuestion(orphan._id);
      expect(stillOrphaned.orphaned).toBe(true);
      expect(String(stillOrphaned.granularObjectiveId)).toBe(String(orphan.granularObjectiveId));
    } finally {
      await deleteQuestions(marker);
    }
  });
});
