const { test, expect } = require('@playwright/test');
const { MongoClient } = require('mongodb');
const sharp = require('sharp');
const { BIO_PROF2_AUTH_FILE } = require('./auth');
const { selectSeededCourse, getQuizCard } = require('./helpers');
const {
  quizXml,
  groupSection,
  mcItem,
  numericalItem,
  calculatedItem,
  metaXml,
} = require('../fixtures/canvas-qti/items');
const { buildManifest, buildExportZip } = require('../fixtures/canvas-qti/zip');

// Importing a Canvas Classic Quizzes export (issue #140) as bio_prof2 on the
// seeded course: preview the zip, choose what to import, import it, then find
// the questions (with their images), one objective per Canvas group and an
// unpublished GRASP quiz. Uploading the same zip again finds everything
// already imported and adds no questions. The export is synthetic and built
// here; its images are bundled in the zip (remote Canvas images are covered by
// the unit tests). Opt-in (E2E_SAML=1).
const IDP_ENABLED = process.env.E2E_SAML === '1';

// Two layouts real exports use for bundled images: a quiz file under
// web_resources/ (a %20-encoded link), and a question-bank file at the root.
const PLOT_SRC = '$IMS-CC-FILEBASE$/Quiz%20Files/e2e/rate-plot.png';
const PLOT_PATH = 'web_resources/Quiz Files/e2e/rate-plot.png';
const RING_SRC = '$IMS-CC-FILEBASE$/assessment_questions/ring-diagram.png?canvas_download=1';
const RING_PATH = 'assessment_questions/ring-diagram.png';
const RING_ALT = 'Synthetic ring diagram';

const CALCULATED_SKIP = 'Formula question with variables. These come in a later update (#130).';
const MEDIA_WARNING = 'Question text: Embedded media was removed.';

// Question HTML as Canvas writes it: a <div> with one block per line.
const html = (...blocks) => ['<div>', ...blocks, '</div>'].join('\n');

// A small solid-colour PNG, so each bundled image is a distinct file.
function png(colour) {
  return sharp({ create: { width: 48, height: 48, channels: 3, background: colour } })
    .png()
    .toBuffer();
}

/**
 * A Canvas export holding two quizzes, laid out as Canvas writes one.
 * Kinetics: group Q01 with two variants (one with a stem image, one with an
 * image-only answer), Q02 with a numerical question, and Q03 with a formula
 * question GRASP skips. Thermo: one question whose embedded video is dropped,
 * so it is saved as Draft. Thermo comes first in the manifest but is due
 * later, so GRASP lists Kinetics first. Quiz idents and question text carry
 * the run's stamp: provenance is per quiz ident, so nothing from another run
 * counts as already imported. Answer shuffling is off to keep option letters
 * as written.
 */
async function buildExport(stamp) {
  const kinetics = { ident: `g${stamp}kinetics`, title: `E2E Canvas Kinetics ${stamp}` };
  const thermo = { ident: `g${stamp}thermo`, title: `E2E Canvas Thermo ${stamp}` };
  const text = {
    plot: `Which synthetic order fits the plot? ${stamp}`,
    ring: `Which synthetic structure is aromatic? ${stamp}`,
    rate: `Synthetic rate constant ${stamp}`,
    heat: `Which synthetic phase change releases heat? ${stamp}`,
  };

  const kineticsXml = quizXml({
    ident: kinetics.ident,
    title: kinetics.title,
    slots: [
      groupSection({
        ident: `${kinetics.ident}q01`,
        title: 'Q01',
        items: [
          mcItem({
            ident: 'e2e-plot',
            stemHtml: html(
              '<p>Study the synthetic rate plot.</p>',
              `<p><img src="${PLOT_SRC}" alt="rate-plot.png"></p>`,
              `<p>${text.plot}</p>`
            ),
            choices: [
              { ident: '1001', text: 'Synthetic zero order' },
              { ident: '1002', text: 'Synthetic first order' },
              { ident: '1003', text: 'Synthetic second order' },
              { ident: '1004', text: 'Synthetic third order' },
              { ident: '1005', text: 'Synthetic mixed order' },
            ],
            correct: '1002',
          }),
          mcItem({
            ident: 'e2e-ring',
            stemHtml: html(`<p>${text.ring}</p>`),
            choices: [
              { ident: '1101', html: `<p><img src="${RING_SRC}" alt="${RING_ALT}"></p>` },
              { ident: '1102', text: 'Synthetic open chain' },
              { ident: '1103', text: 'Synthetic branched chain' },
              { ident: '1104', text: 'Synthetic cage' },
            ],
            correct: '1101',
          }),
        ],
      }),
      groupSection({
        ident: `${kinetics.ident}q02`,
        title: 'Q02',
        items: [
          numericalItem({
            ident: 'e2e-rate',
            title: text.rate,
            stemHtml: html('<p>Give the synthetic rate constant in s<sup>-1</sup>.</p>'),
            answers: [{ exact: '12.5', min: '12.4', max: '12.6' }],
          }),
        ],
      }),
      groupSection({
        ident: `${kinetics.ident}q03`,
        title: 'Q03',
        items: [calculatedItem({ ident: 'e2e-formula' })],
      }),
    ],
  });

  const thermoXml = quizXml({
    ident: thermo.ident,
    title: thermo.title,
    slots: [
      mcItem({
        ident: 'e2e-heat',
        stemHtml: html(
          '<p>Watch the synthetic clip.</p>',
          '<p><iframe src="https://canvas.example.test/media_objects_iframe/m-synthetic"></iframe></p>',
          `<p>${text.heat}</p>`
        ),
      }),
    ],
  });

  const buffer = await buildExportZip({
    entries: {
      'imsmanifest.xml': buildManifest({ quizzes: [thermo, kinetics], files: [PLOT_PATH, RING_PATH] }),
      [`${thermo.ident}/${thermo.ident}.xml`]: thermoXml,
      [`${thermo.ident}/assessment_meta.xml`]: metaXml({
        ident: thermo.ident,
        title: thermo.title,
        shuffleAnswers: false,
        dueAt: '2026-01-19T07:59:00Z',
      }),
      [`${kinetics.ident}/${kinetics.ident}.xml`]: kineticsXml,
      [`${kinetics.ident}/assessment_meta.xml`]: metaXml({
        ident: kinetics.ident,
        title: kinetics.title,
        shuffleAnswers: false,
        dueAt: '2026-01-12T07:59:00Z',
      }),
      [PLOT_PATH]: await png('#1d4ed8'),
      [RING_PATH]: await png('#047857'),
    },
  });
  return { buffer, kinetics, thermo, text };
}

// Everything an import makes carries its Canvas quiz ident (`source`), except
// the course's "From Canvas" material. Deleted through the API so question
// images go with their questions, and each objective with its granular and
// its material links.
async function deleteImported(page, quizIdents) {
  const uri = process.env.MONGODB_URI;
  if (!uri) return;
  const client = new MongoClient(uri, { connectTimeoutMS: 8000 });
  await client.connect();
  try {
    const db = client.db(process.env.MONGODB_DB_NAME || undefined);
    const bySource = { 'source.quizIdent': { $in: quizIdents } };
    const idsOf = async (collection, filter) =>
      (await db.collection(collection).find(filter, { projection: { _id: 1 } }).toArray()).map(
        (doc) => String(doc._id)
      );
    for (const id of await idsOf('grasp_question', bySource)) {
      await page.request.delete(`/api/question/${id}`);
    }
    for (const id of await idsOf('grasp_quiz', bySource)) {
      await page.request.delete(`/api/quiz/${id}`);
    }
    const objectives = await db
      .collection('grasp_objective')
      .find({ ...bySource, parent: 0 }, { projection: { courseId: 1 } })
      .toArray();
    for (const objective of objectives) {
      await page.request.delete(`/api/objective/${objective._id}?questionAction=delete`);
    }
    for (const courseId of new Set(objectives.map((objective) => String(objective.courseId)))) {
      await page.request.delete(`/api/material/delete/${courseId}-from-canvas`);
    }
  } finally {
    await client.close();
  }
}

async function openImportDialog(page) {
  await page.getByRole('button', { name: 'Add New Question' }).click();
  await page
    .getByRole('dialog', { name: 'Add Questions' })
    .getByRole('button', { name: 'Import Questions' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Import Questions' });
  await expect(dialog).toBeVisible();
  return dialog;
}

// The result's totals are a <dl>: every label in order, then every count.
async function expectTotals(dialog, totals) {
  await expect(dialog.getByRole('term')).toHaveText(Object.keys(totals));
  await expect(dialog.getByRole('definition')).toHaveText(Object.values(totals).map(String));
}

// The question's image is a stored file, served as the PNG from the export.
async function expectStoredPng(page, image) {
  const response = await page.request.get(await image.getAttribute('src'));
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toBe('image/png');
}

test.describe('Instructor Canvas quiz import (issue #140)', () => {
  test.skip(!IDP_ENABLED, 'Requires the SAML IdP - run with E2E_SAML=1');
  test.use({ storageState: BIO_PROF2_AUTH_FILE });

  test('imports a Canvas quiz export once, then finds it already imported', async ({ page }) => {
    const stamp = Date.now();
    const { buffer, kinetics, thermo, text } = await buildExport(stamp);
    const file = { name: `quiz-export-${stamp}.zip`, mimeType: 'application/zip', buffer };

    // Page-level locators: `has` filters resolve their locator inside the row.
    const importBox = (quiz) =>
      page.getByRole('checkbox', { name: `Import ${quiz.title}`, exact: true });
    const createQuizBox = (quiz) =>
      page.getByRole('checkbox', { name: `Create a GRASP quiz from ${quiz.title}`, exact: true });
    const quizRow = (quiz) => page.getByRole('listitem').filter({ has: importBox(quiz) });
    const questionRow = (questionText) => page.getByRole('row').filter({ hasText: questionText });

    try {
      const course = await selectSeededCourse(page, { role: 'instructor' });
      await page.goto('/question-bank');

      await test.step('preview lists both quizzes by due date with counts and skip reasons', async () => {
        const dialog = await openImportDialog(page);
        await dialog.getByLabel('Export file').setInputFiles(file);

        await expect(
          dialog.getByText('2 quizzes · 4 of 5 questions can be imported · 1 skipped', { exact: true })
        ).toBeVisible();
        const importBoxes = dialog.getByRole('checkbox', { name: /^Import / });
        await expect(importBoxes).toHaveCount(2);
        await expect(importBoxes.nth(0)).toHaveAccessibleName(`Import ${kinetics.title}`);
        await expect(importBoxes.nth(1)).toHaveAccessibleName(`Import ${thermo.title}`);

        await expect(quizRow(kinetics).getByText('4 questions in 3 groups · 3 to import')).toBeVisible();
        await quizRow(kinetics).getByText('Skipped (1)').click();
        await expect(quizRow(kinetics).getByText(`${CALCULATED_SKIP} (1)`)).toBeVisible();
        await expect(quizRow(kinetics).getByText('Q03', { exact: true })).toBeVisible();

        await expect(quizRow(thermo).getByText('1 question in 1 group · 1 to import')).toBeVisible();
        await quizRow(thermo).getByText('Will be saved as Draft to check (1)').click();
        await expect(quizRow(thermo).getByText(MEDIA_WARNING)).toBeVisible();

        // Both quizzes are ticked, each to become a GRASP quiz.
        await expect(importBox(kinetics)).toBeChecked();
        await expect(importBox(thermo)).toBeChecked();
        await expect(createQuizBox(kinetics)).toBeChecked();
        await expect(createQuizBox(thermo)).toBeChecked();
        await expect(dialog.getByRole('button', { name: 'Import 4 questions' })).toBeEnabled();
      });

      await test.step('choosing quizzes changes what is imported', async () => {
        const dialog = page.getByRole('dialog', { name: 'Import Questions' });
        await importBox(thermo).uncheck();
        await expect(dialog.getByRole('button', { name: 'Import 3 questions' })).toBeEnabled();
        await expect(createQuizBox(thermo)).toBeDisabled();

        await importBox(thermo).check();
        await expect(dialog.getByRole('button', { name: 'Import 4 questions' })).toBeEnabled();
        // Thermo's question comes in without a GRASP quiz.
        await createQuizBox(thermo).uncheck();
        await expect(createQuizBox(kinetics)).toBeChecked();
      });

      await test.step('importing reports what was created', async () => {
        const dialog = page.getByRole('dialog', { name: 'Import Questions' });
        await dialog.getByRole('button', { name: 'Import 4 questions' }).click();

        await expect(dialog.getByRole('heading', { name: 'Import finished', exact: true })).toBeVisible();
        await expectTotals(dialog, {
          'Questions imported': 4,
          Approved: 3,
          'Saved as Draft': 1,
          'Learning objectives created': 3,
          'GRASP quizzes created': 1,
          'GRASP quizzes updated': 0,
          'Already imported': 0,
          Skipped: 1,
          'Images that could not be imported': 0,
        });
        await dialog.getByRole('button', { name: 'Done' }).click();
        await expect(dialog).toBeHidden();
      });

      await test.step('the GRASP quiz holds the Canvas quiz questions, one objective per group', async () => {
        await page.getByLabel('Quiz').selectOption({ label: kinetics.title });
        for (const questionText of [text.plot, text.ring, text.rate]) {
          await expect(questionRow(questionText)).toHaveCount(1);
        }
        await expect(questionRow(text.heat)).toHaveCount(0);
        await expect(page.getByRole('cell', { name: 'Approved', exact: true })).toHaveCount(3);
        // Both Q01 variants share one objective, so the quiz serves one of them.
        await expect(
          page.getByRole('cell', { name: `${kinetics.title} – Q01`, exact: true })
        ).toHaveCount(2);
        await expect(
          page.getByRole('cell', { name: `${kinetics.title} – Q02`, exact: true })
        ).toHaveCount(1);
      });

      await test.step('imported questions keep their stem and option images', async () => {
        await questionRow(text.plot).getByRole('button', { name: 'View/Edit' }).click();
        let dialog = page.getByRole('dialog', { name: 'Edit question' });
        // The image sat mid-text in Canvas, so the text marks its place.
        await expect(dialog.getByLabel('Question Title')).toHaveValue(
          `Study the synthetic rate plot.\n(Image 1)\n${text.plot}`
        );
        const plot = dialog.getByRole('img', { name: 'Image 1' });
        await expect(plot).toBeVisible();
        await expectStoredPng(page, plot);
        await expect(dialog.getByLabel('Option E text')).toHaveValue('Synthetic mixed order');
        await expect(dialog.getByLabel('Mark option B as the correct answer')).toBeChecked();
        await dialog.getByRole('button', { name: 'Cancel' }).click();
        await expect(dialog).toBeHidden();

        await questionRow(text.ring).getByRole('button', { name: 'View/Edit' }).click();
        dialog = page.getByRole('dialog', { name: 'Edit question' });
        const ring = dialog.getByRole('img', { name: RING_ALT });
        await expect(ring).toBeVisible();
        await expectStoredPng(page, ring);
        await expect(dialog.getByLabel('Option A text')).toHaveValue('');
        await expect(dialog.getByLabel('Option A image alt text')).toHaveValue(RING_ALT);
        await expect(dialog.getByLabel('Mark option A as the correct answer')).toBeChecked();
        await dialog.getByRole('button', { name: 'Cancel' }).click();
        await expect(dialog).toBeHidden();
      });

      await test.step('a numerical answer keeps its margin as a tolerance', async () => {
        await questionRow(text.rate).getByRole('button', { name: 'View/Edit' }).click();
        const dialog = page.getByRole('dialog', { name: 'Edit question' });
        await expect(dialog.getByLabel('Accepted answers')).toHaveValue('absolute');
        await expect(dialog.getByLabel('Tolerance amount')).toHaveValue('0.1');
        await dialog.getByRole('button', { name: 'Cancel' }).click();
        await expect(dialog).toBeHidden();
      });

      await test.step('a lossy question is a Draft that says what to check', async () => {
        await page.getByLabel('Quiz').selectOption('all');
        await expect(questionRow(text.heat).getByRole('cell', { name: 'Draft', exact: true })).toBeVisible();
        await questionRow(text.heat).getByRole('button', { name: 'View/Edit' }).click();
        const dialog = page.getByRole('dialog', { name: 'Edit question' });
        await expect(dialog.getByText('Imported from Canvas. Check before approving:')).toBeVisible();
        await expect(dialog.getByRole('listitem').filter({ hasText: MEDIA_WARNING })).toBeVisible();
        await dialog.getByRole('button', { name: 'Cancel' }).click();
        await expect(dialog).toBeHidden();
      });

      await test.step('each imported group is a learning objective, linked to "From Canvas"', async () => {
        await page.getByRole('button', { name: 'Learning Objectives' }).click();
        const objectiveCard = (name) =>
          page
            .getByRole('heading', { name, exact: true })
            .locator('xpath=ancestor::div[contains(@class, "rounded-2xl")][1]');
        for (const name of [
          `${kinetics.title} – Q01`,
          `${kinetics.title} – Q02`,
          `${thermo.title} – Question 1`,
        ]) {
          await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
          // The course's "From Canvas" material, not "No materials linked." (#165).
          await expect(objectiveCard(name).getByText('From Canvas', { exact: true })).toBeVisible();
          await expect(objectiveCard(name).getByText('No materials linked.')).toHaveCount(0);
        }
        // Nothing from Q03 was imported, so it has no objective.
        await expect(
          page.getByRole('heading', { name: `${kinetics.title} – Q03`, exact: true })
        ).toHaveCount(0);

        // With a material linked, an imported objective can be renamed.
        const renamed = `${kinetics.title} – rate constants`;
        // The card's icon buttons are named by their title only.
        await objectiveCard(`${kinetics.title} – Q02`).getByTitle('Edit Objective').click();
        const editDialog = page.getByRole('dialog', { name: 'Edit Learning Objective' });
        await expect(editDialog.getByRole('checkbox', { name: 'From Canvas' })).toBeChecked();
        await editDialog.getByPlaceholder('e.g., Understanding Cellular Respiration').fill(renamed);
        await editDialog.getByRole('button', { name: 'Save Objective' }).click();
        await expect(editDialog).toBeHidden();
        await expect(page.getByRole('heading', { name: renamed, exact: true })).toBeVisible();
        await expect(objectiveCard(renamed).getByText('From Canvas', { exact: true })).toBeVisible();
      });

      await test.step('the course has one "From Canvas" material, with nothing to edit', async () => {
        await page.goto('/course-materials');
        const heading = page.getByRole('heading', { name: 'From Canvas', exact: true });
        await expect(heading).toHaveCount(1);
        const card = heading.locator('xpath=ancestor::div[contains(@class, "rounded-2xl")][1]');
        await expect(card.getByText('Canvas quiz import', { exact: true })).toBeVisible();
        await expect(card.getByText(/^Created by a Canvas quiz import on /)).toBeVisible();
        await expect(card.getByRole('button', { name: 'Edit' })).toHaveCount(0);
        await expect(card.getByRole('button', { name: /^Outline for / })).toHaveCount(0);
        await expect(card.getByRole('button', { name: 'Delete' })).toBeVisible();
      });

      await test.step('the GRASP quiz is unpublished and uses spaced delivery', async () => {
        await page.goto('/quizzes');
        await expect(
          getQuizCard(page, kinetics.title).getByRole('button', { name: 'Publish', exact: true })
        ).toBeVisible();
        await expect(page.getByRole('heading', { name: thermo.title, exact: true })).toHaveCount(0);

        // The delivery format toggle shows no pressed state, so read the quiz
        // the way the Quizzes page does.
        const response = await page.request.get(`/api/quiz/course/${course.id}`);
        expect(response.ok()).toBe(true);
        const { quizzes } = await response.json();
        const created = quizzes.find((quiz) => quiz.name === kinetics.title);
        expect(created).toMatchObject({ published: false, deliveryFormat: 'spaced-3phase' });
      });

      await test.step('uploading the export again finds everything already imported', async () => {
        await page.goto('/question-bank');
        const dialog = await openImportDialog(page);
        await dialog.getByLabel('Export file').setInputFiles(file);

        const summary = '2 quizzes · 0 of 5 questions can be imported · 1 skipped · 4 already imported';
        await expect(dialog.getByText(summary, { exact: true })).toBeVisible();
        await expect(
          dialog.getByText('Everything in this export that GRASP can import is already in this course.')
        ).toBeVisible();
        await expect(importBox(kinetics)).toBeDisabled();
        await expect(
          quizRow(kinetics).getByText(`Its questions are in the GRASP quiz “${kinetics.title}”.`)
        ).toBeVisible();
        await expect(dialog.getByRole('button', { name: 'Import', exact: true })).toBeDisabled();

        // Thermo's question came in without a quiz; it can still get one, and
        // that imports no question twice.
        await expect(importBox(thermo)).not.toBeChecked();
        await importBox(thermo).check();
        await dialog.getByRole('button', { name: 'Create 1 GRASP quiz' }).click();

        await expect(dialog.getByRole('heading', { name: 'Import finished', exact: true })).toBeVisible();
        await expectTotals(dialog, {
          'Questions imported': 0,
          Approved: 0,
          'Saved as Draft': 0,
          'Learning objectives created': 0,
          'GRASP quizzes created': 1,
          'GRASP quizzes updated': 0,
          'Already imported': 1,
          Skipped: 0,
          'Images that could not be imported': 0,
        });
        await dialog.getByRole('button', { name: 'Done' }).click();
        await expect(dialog).toBeHidden();

        // Still one copy of every question, and Thermo's is in its new quiz.
        for (const questionText of [text.plot, text.ring, text.rate, text.heat]) {
          await expect(questionRow(questionText)).toHaveCount(1);
        }
        await page.getByLabel('Quiz').selectOption({ label: thermo.title });
        await expect(questionRow(text.heat)).toHaveCount(1);
        await expect(questionRow(text.plot)).toHaveCount(0);
      });
    } finally {
      await deleteImported(page, [kinetics.ident, thermo.ident]);
    }
  });
});
