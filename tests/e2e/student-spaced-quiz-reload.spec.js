const { test, expect } = require('@playwright/test');
const { MongoClient } = require('mongodb');
const { BIO_STUDENT_AUTH_FILE } = require('./auth');
const { SEED } = require('./seed');
const { selectSeededCourse, startQuizFromList } = require('./helpers');

// A spaced-3phase quiz keeps each student's pick for the graded attempt
// (issue #168). bio_student opens a spaced quiz whose only objective has three
// variants, as a Canvas "pick 1 of N" group imports. They answer the variant
// they were served, reload, and get the same variant back with their answer,
// where the pick used to be made again on every load (unseen first, so
// answering one served the next). The variants they were not served cannot be
// answered either. The quiz is released before every seeded quiz, so it is
// first in bio_student's order and serves no remediation or review questions.
// Opt-in (E2E_SAML=1).
const IDP_ENABLED = process.env.E2E_SAML === '1';
const DAY = 24 * 60 * 60 * 1000;

async function withDb(fn) {
  const client = new MongoClient(process.env.MONGODB_URI, { connectTimeoutMS: 8000 });
  await client.connect();
  try {
    return await fn(client.db(process.env.MONGODB_DB_NAME || undefined));
  } finally {
    await client.close();
  }
}

test.describe('Student spaced quiz keeps its questions on reload (issue #168)', () => {
  test.skip(!IDP_ENABLED, 'Requires the SAML IdP - run with E2E_SAML=1');
  test.use({ storageState: BIO_STUDENT_AUTH_FILE });

  const stamp = Date.now();
  const quizName = `Spaced variants ${stamp}`;
  const variants = ['first', 'second', 'third'].map((label) => `Which variant is this, ${label}? ${stamp}`);
  const rightOption = `Right ${stamp}`;
  let seeded;

  test.beforeAll(async () => {
    seeded = await withDb(async (db) => {
      const course = await db.collection('grasp_course').findOne({ courseName: SEED.COURSE_NAME });
      const section = await db
        .collection('grasp_course_section')
        .findOne({ courseId: course._id, sectionId: SEED.SECTION_ID });
      const now = new Date();
      const objective = (name, parent) =>
        db.collection('grasp_objective').insertOne({
          name,
          parent,
          courseId: course._id,
          createdAt: now,
          updatedAt: now,
        });
      const meta = (await objective(`Spaced variants ${stamp}`, 0)).insertedId;
      const granular = (await objective(`Spaced variants ${stamp}`, meta)).insertedId;
      const quizId = (
        await db.collection('grasp_quiz').insertOne({
          courseId: course._id,
          name: quizName,
          published: true,
          deliveryFormat: 'spaced-3phase',
          timeLimitMinutes: 60,
          createdAt: now,
          updatedAt: now,
        })
      ).insertedId;
      const questionIds = [];
      for (const title of variants) {
        const { insertedId } = await db.collection('grasp_question').insertOne({
          courseId: course._id,
          title,
          stem: 'Select the best answer:',
          questionType: 'multiple-choice',
          status: 'Approved',
          bloom: 'Understand',
          learningObjectiveId: meta,
          granularObjectiveId: granular,
          options: {
            A: { text: rightOption, feedback: '' },
            B: { text: `Wrong ${stamp}`, feedback: '' },
          },
          correctAnswer: 'A',
          createdAt: now,
          updatedAt: now,
        });
        questionIds.push(insertedId);
        await db.collection('grasp_quiz_question').insertOne({ quizId, questionId: insertedId, createdAt: now });
      }
      await db.collection('grasp_quiz_section_schedule').insertOne({
        quizId,
        courseSectionId: section._id,
        releaseDate: new Date(now.getTime() - 3650 * DAY),
        expireDate: new Date(now.getTime() + 365 * DAY),
        createdAt: now,
        updatedAt: now,
      });
      return { quizId, questionIds, objectiveIds: [meta, granular] };
    });
  });

  test.afterAll(async () => {
    if (!seeded) return;
    await withDb(async (db) => {
      const { quizId, questionIds, objectiveIds } = seeded;
      for (const name of [
        'grasp_quiz_question',
        'grasp_quiz_section_schedule',
        'grasp_quiz_session',
        'grasp_student_attempt',
        'grasp_quiz_score',
      ]) {
        await db.collection(name).deleteMany({ quizId });
      }
      await db.collection('grasp_quiz').deleteOne({ _id: quizId });
      await db.collection('grasp_question').deleteMany({ _id: { $in: questionIds } });
      await db.collection('grasp_objective').deleteMany({ _id: { $in: objectiveIds } });
      await db.collection('grasp_student_performance').deleteMany({ learningObjectiveId: objectiveIds[0] });
    });
  });

  test('a reload serves the same variant with its answer, and the others cannot be answered', async ({
    page,
  }) => {
    await selectSeededCourse(page, { role: 'student' });
    await page.goto('/quiz');
    await startQuizFromList(page, quizName);
    await expect(page.getByText(/1 of 1/)).toBeVisible();

    const shown = [];
    for (const title of variants) {
      if (await page.getByText(title, { exact: true }).isVisible()) shown.push(title);
    }
    expect(shown, 'exactly one variant is served').toHaveLength(1);
    const [served] = shown;
    const servedId = String(seeded.questionIds[variants.indexOf(served)]);

    await page.getByRole('button', { name: rightOption }).click();
    await expect(page.getByText('Correct!')).toBeVisible();

    // Reload without submitting: the same variant comes back, answered.
    await page.goto('/quiz');
    await startQuizFromList(page, quizName);
    await expect(page.getByText(/1 of 1/)).toBeVisible();
    await expect(page.getByText(served, { exact: true })).toBeVisible();
    await expect(page.getByText('Correct!')).toBeVisible();
    for (const title of variants.filter((candidate) => candidate !== served)) {
      await expect(page.getByText(title, { exact: true })).toHaveCount(0);
    }

    // Asking again directly gives the same pick.
    const again = await page.request.get(`/api/student/quizzes/${seeded.quizId}/questions`);
    expect(again.ok()).toBe(true);
    expect((await again.json()).data.questions.map((question) => question.id)).toEqual([servedId]);

    // The variants this attempt did not serve cannot be answered.
    for (const questionId of seeded.questionIds.map(String).filter((id) => id !== servedId)) {
      const check = await page.request.post(`/api/quiz/${seeded.quizId}/question/${questionId}/check`, {
        data: { selectedIndex: 0 },
      });
      expect(check.status()).toBe(403);
      expect((await check.json()).code).toBe('QUESTION_NOT_IN_ATTEMPT');
    }
  });
});
