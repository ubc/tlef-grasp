// Canvas Classic Quizzes import service (#140): preview and per-quiz commit.
//
// The zip reader, parser and mapper run for real on synthetic exports built
// with tests/fixtures/canvas-qti. So do the question, objective and quiz
// services; only their storage is replaced: MongoDB by a small in-memory
// stand-in that honours the filters these services use, GridFS by mocked
// uploadImage/deleteImages, and Canvas image downloads by an injected fetcher.

const { ObjectId } = require('mongodb');

jest.mock('../../src/services/database', () => ({ connect: jest.fn() }));
jest.mock('../../src/services/image', () => ({
  ...jest.requireActual('../../src/services/image'),
  uploadImage: jest.fn(),
  deleteImages: jest.fn(),
}));

const databaseService = require('../../src/services/database');
const { uploadImage, deleteImages } = require('../../src/services/image');
const {
  buildImportPlan,
  previewCanvasImport,
  commitCanvasQuiz,
  IMAGE_WARNINGS,
} = require('../../src/services/canvas-quiz-import');
const { CanvasImportError } = require('../../src/utils/canvas-qti-package');
const { buildManifest, buildExportZip } = require('../fixtures/canvas-qti/zip');
const items = require('../fixtures/canvas-qti/items');

const COURSE_ID = '64b000000000000000000001';
const OTHER_COURSE_ID = '64b000000000000000000002';
const USER = { _id: '64b0000000000000000000aa' };
const HOSTS = new Set(['canvas.example.test']);

const CALCULATED_REASON = 'Formula question with variables. These come in a later update (#130).';
const ESSAY_REASON =
  "Essay questions aren't imported yet: GRASP needs a sample answer and grading criteria for them.";

// ---- In-memory MongoDB ---------------------------------------------------------

function valueAt(doc, path) {
  return path.split('.').reduce((value, key) => (value == null ? undefined : value[key]), doc);
}

// Strict like MongoDB: an ObjectId never equals its hex string.
function same(a, b) {
  if (a instanceof ObjectId || b instanceof ObjectId) {
    return a instanceof ObjectId && b instanceof ObjectId && a.equals(b);
  }
  return a === b;
}

function matches(doc, filter) {
  return Object.entries(filter).every(([path, condition]) => {
    const value = valueAt(doc, path);
    if (condition && typeof condition === 'object' && !(condition instanceof ObjectId)) {
      return Object.entries(condition).every(([op, arg]) => {
        if (op === '$in') return arg.some((candidate) => same(value, candidate));
        if (op === '$ne') return !same(value, arg);
        if (op === '$exists') return (value !== undefined) === arg;
        if (op === '$lt') return value instanceof Date && value < arg;
        throw new Error(`fake db: unsupported operator ${op}`);
      });
    }
    return same(value, condition);
  });
}

// Inclusion projections of top-level fields, as the services use them: a
// field left out of one is not there for the code that reads the result.
function project(doc, projection) {
  if (!projection) return { ...doc };
  const fields = Object.keys(projection);
  if (fields.some((field) => field.includes('.') || !projection[field])) {
    throw new Error('fake db: unsupported projection');
  }
  return Object.fromEntries(['_id', ...fields].filter((field) => field in doc).map((field) => [field, doc[field]]));
}

function cursor(docs, projection) {
  return {
    project: (fields) => cursor(docs, fields),
    toArray: async () => docs.map((doc) => project(doc, projection)),
    next: async () => (docs[0] ? project(docs[0], projection) : null),
  };
}

function createFakeDb() {
  const collections = new Map();
  let failInsert = () => false;

  const collection = (name) => {
    if (collections.has(name)) return collections.get(name);
    const docs = [];
    const duplicateKey = () => Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
    const insert = (doc) => {
      if (failInsert(name, doc)) throw new Error('insert failed');
      if (doc._id !== undefined && docs.some((d) => same(d._id, doc._id))) throw duplicateKey();
      // grasp_quiz_question has a unique index on the pair.
      if (name === 'grasp_quiz_question'
        && docs.some((d) => same(d.quizId, doc.quizId) && same(d.questionId, doc.questionId))) {
        throw duplicateKey();
      }
      const stored = { _id: new ObjectId(), ...doc };
      docs.push(stored);
      return stored._id;
    };
    const api = {
      docs,
      find: (filter = {}, options = {}) => cursor(docs.filter((doc) => matches(doc, filter)), options.projection),
      findOne: async (filter = {}) => {
        const doc = docs.find((d) => matches(d, filter));
        return doc ? { ...doc } : null;
      },
      insertOne: async (doc) => ({ insertedId: insert(doc) }),
      insertMany: async (list) => ({
        insertedIds: Object.fromEntries(list.map((doc, index) => [index, insert(doc)])),
      }),
      deleteOne: async (filter) => {
        const index = docs.findIndex((doc) => matches(doc, filter));
        if (index >= 0) docs.splice(index, 1);
        return { deletedCount: index >= 0 ? 1 : 0 };
      },
      // Only what the importer sends: $addToSet with $each.
      updateOne: async (filter, update) => {
        const doc = docs.find((d) => matches(d, filter));
        Object.entries(update).forEach(([op, fields]) => {
          if (op !== '$addToSet') throw new Error(`fake db: unsupported update ${op}`);
          if (!doc) return;
          Object.entries(fields).forEach(([field, { $each }]) => {
            doc[field] = [...new Set([...(doc[field] || []), ...$each])];
          });
        });
        return { matchedCount: doc ? 1 : 0 };
      },
    };
    collections.set(name, api);
    return api;
  };

  return {
    db: { collection },
    docs: (name) => collection(name).docs,
    seed: (name, doc) => {
      const stored = { _id: new ObjectId(), ...doc };
      collection(name).docs.push(stored);
      return stored;
    },
    failInsertWhen: (predicate) => {
      failInsert = predicate;
    },
  };
}

// ---- Synthetic exports -----------------------------------------------------------

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const png = (label) => Buffer.concat([PNG_SIGNATURE, Buffer.from(`synthetic png ${label}`)]);
const jpeg = (label) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`synthetic jpeg ${label}`)]);

// Canvas links carry a verifier token, which must never leave the service.
const remote = (fileId) =>
  `https://canvas.example.test/assessment_questions/7/files/${fileId}/download?verifier=secret${fileId}`;
const R_SALT = remote(11);
const R_CURVE = remote(12);

const ALPHA = 'gquizalpha';
const BETA = 'gquizbeta';
const SALT_STEM = `<p>Which synthetic salt dissolves first?</p><p><img src="${R_SALT}" alt="salt.png"></p>`;

const alphaQuiz = () => ({
  ident: ALPHA,
  title: 'Alpha Quiz',
  meta: { dueAt: '2026-02-10T07:59:59' },
  slots: [
    // Two variants sharing one remote picture.
    items.groupSection({
      ident: 'ggroupa1',
      title: 'Q01',
      items: [
        items.mcItem({ ident: 'gitema1', stemHtml: SALT_STEM }),
        items.mcItem({ ident: 'gitema2', stemHtml: SALT_STEM }),
      ],
    }),
    // A stem picture inside the zip and a picture-only (correct) option.
    items.groupSection({
      ident: 'ggroupa2',
      title: 'Q02',
      items: [
        items.mcItem({
          ident: 'gitema3',
          stemHtml: '<p>Which graph matches the synthetic data?</p><p><img src="$IMS-CC-FILEBASE$/assessment_questions/diagram.png" alt="diagram.png"></p>',
          choices: [
            { ident: '3101', html: `<p><img src="${R_CURVE}" alt="Rising curve"></p>` },
            { ident: '3102', text: 'A flat line' },
            { ident: '3103', text: 'A falling line' },
          ],
          correct: '3101',
        }),
      ],
    }),
    items.numericalItem({ ident: 'gitema4', title: 'Synthetic yield', answers: [{ exact: '2.5', min: '2.3', max: '2.7' }] }),
    items.calculatedItem({ ident: 'gitema5' }),
  ],
});

// Due before Alpha, so it is created (and previewed) first.
const betaQuiz = () => ({
  ident: BETA,
  title: 'Beta Quiz',
  meta: { dueAt: '2026-01-20T07:59:59' },
  slots: [
    items.mcItem({ ident: 'gitemb1', stemHtml: '<p>Which synthetic gas is inert?</p>' }),
    items.groupSection({ ident: 'ggroupb1', title: 'Q02', items: [items.otherItem({ ident: 'gitemb2' })] }),
  ],
});

const BUNDLED = { 'assessment_questions/diagram.png': png('diagram') };

async function exportZip(quizzes, files = {}) {
  const entries = {
    'imsmanifest.xml': buildManifest({ quizzes: quizzes.map(({ ident }) => ({ ident })), files: Object.keys(files) }),
  };
  for (const quiz of quizzes) {
    entries[`${quiz.ident}/${quiz.ident}.xml`] = items.quizXml({ ident: quiz.ident, title: quiz.title, slots: quiz.slots });
    entries[`${quiz.ident}/assessment_meta.xml`] = items.metaXml({ ident: quiz.ident, title: quiz.title, ...quiz.meta });
  }
  return buildExportZip({ entries: { ...entries, ...files } });
}

const fakeFetcher = (responses) => ({
  fetchImage: jest.fn(async (url) => responses[url] || { ok: false, reason: 'http-404' }),
});

const okImage = (data, mimeType) => ({ ok: true, data, mimeType });

// The GridFS id the mocked uploadImage gives its n-th upload.
const fileIdOf = (n) => `64c0000000000000000000${String(n).padStart(2, '0')}`;

// ---- Helpers ---------------------------------------------------------------------

const courseObj = new ObjectId(COURSE_ID);
const ALPHA_SOURCE = (itemIdent, slotIdent) => ({ kind: 'canvas-classic', quizIdent: ALPHA, itemIdent, slotIdent });

let fake;
let consoleOutput;

function questionBy(itemIdent) {
  return fake.docs('grasp_question').find((doc) => doc.source && doc.source.itemIdent === itemIdent);
}

function objectiveNamed(name) {
  return fake.docs('grasp_objective').find((doc) => doc.name === name && doc.parent === 0);
}

function childrenOf(parent) {
  return fake.docs('grasp_objective').filter((doc) => doc.parent instanceof ObjectId && doc.parent.equals(parent._id));
}

function linksOf(quizId) {
  return fake.docs('grasp_quiz_question')
    .filter((link) => String(link.quizId) === String(quizId))
    .map((link) => String(link.questionId));
}

const idsOf = (...itemIdents) => itemIdents.map((ident) => String(questionBy(ident)._id)).sort();

async function previewAlpha(buffer) {
  const report = await previewCanvasImport({ courseId: COURSE_ID, buffer, deps: { imageHosts: HOSTS } });
  const { importable, alreadyImported, unlinked } = report.quizzes.find((quiz) => quiz.ident === ALPHA);
  return { importable, alreadyImported, unlinked };
}

function commit(buffer, overrides = {}) {
  return commitCanvasQuiz({
    courseId: COURSE_ID,
    buffer,
    quizIdent: ALPHA,
    createQuiz: true,
    user: USER,
    canApprove: true,
    canCreateQuizzes: true,
    ...overrides,
    deps: {
      fetcher: fakeFetcher({ [R_SALT]: okImage(png('salt'), 'image/png'), [R_CURVE]: okImage(jpeg('curve'), 'image/jpeg') }),
      ...overrides.deps,
    },
  });
}

beforeEach(() => {
  fake = createFakeDb();
  databaseService.connect.mockResolvedValue(fake.db);
  let n = 0;
  uploadImage.mockImplementation(async (buffer, { filename, mimeType }) => {
    n += 1;
    return { fileId: fileIdOf(n), filename, mimeType, size: buffer.length };
  });
  deleteImages.mockResolvedValue(undefined);
  consoleOutput = [];
  for (const level of ['log', 'warn', 'error']) {
    jest.spyOn(console, level).mockImplementation((...args) => {
      consoleOutput.push(args.map((arg) => (arg instanceof Error ? arg.stack : JSON.stringify(arg))).join(' '));
    });
  }
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ---- buildImportPlan -------------------------------------------------------------

describe('buildImportPlan', () => {
  it('maps every quiz and orders them by Canvas due date', async () => {
    const plan = buildImportPlan(await exportZip([alphaQuiz(), betaQuiz()], BUNDLED));

    expect(plan.manifestTitle).toBe('QTI Quiz Export for course "Synthetic Chemistry 100"');
    expect(plan.quizzes.map((quiz) => quiz.ident)).toEqual([BETA, ALPHA]);
    expect(plan.xmlPaths.get(ALPHA)).toBe(`${ALPHA}/${ALPHA}.xml`);
    expect(plan.resolveFile('$IMS-CC-FILEBASE$/assessment_questions/diagram.png').data).toEqual(png('diagram'));
  });

  it('rejects a file that is not a zip with the reader\'s message', () => {
    expect(() => buildImportPlan(Buffer.from('not a zip at all'))).toThrow(
      new CanvasImportError("That file isn't a zip archive. Upload the .zip that Canvas gave you.", 'NOT_A_ZIP'),
    );
  });
});

// ---- previewCanvasImport ---------------------------------------------------------

describe('previewCanvasImport', () => {
  it('reports what each quiz would import, in creation order, writing nothing', async () => {
    const buffer = await exportZip([alphaQuiz(), betaQuiz()], BUNDLED);

    const report = await previewCanvasImport({ courseId: COURSE_ID, buffer, deps: { imageHosts: HOSTS } });

    expect(report).toEqual({
      manifestTitle: 'QTI Quiz Export for course "Synthetic Chemistry 100"',
      totals: {
        quizzes: 2,
        items: 7,
        importable: 5,
        alreadyImported: 0,
        skipped: 2,
        remoteImages: 2,
        bundledImages: 1,
        predictedDrafts: 0,
      },
      quizzes: [
        {
          ident: BETA,
          title: 'Beta Quiz',
          flavour: 'classic',
          dueAt: '2026-01-20T07:59:59.000Z',
          position: 2,
          items: 2,
          importable: 1,
          alreadyImported: 0,
          unlinked: 0,
          skippedCount: 1,
          slots: [
            { name: 'Beta Quiz – Question 1', variants: 1, importable: 1, alreadyImported: 0 },
            { name: 'Beta Quiz – Q02', variants: 1, importable: 0, alreadyImported: 0 },
          ],
          existingQuiz: null,
          skipped: [{ slotName: 'Beta Quiz – Q02', itemTitle: 'Question', canvasType: 'essay_question', reason: ESSAY_REASON }],
          predictedDrafts: [],
          notes: [],
        },
        {
          ident: ALPHA,
          title: 'Alpha Quiz',
          flavour: 'classic',
          dueAt: '2026-02-10T07:59:59.000Z',
          position: 1,
          items: 5,
          importable: 4,
          alreadyImported: 0,
          unlinked: 0,
          skippedCount: 1,
          slots: [
            { name: 'Alpha Quiz – Q01', variants: 2, importable: 2, alreadyImported: 0 },
            { name: 'Alpha Quiz – Q02', variants: 1, importable: 1, alreadyImported: 0 },
            { name: 'Alpha Quiz – Question 3', variants: 1, importable: 1, alreadyImported: 0 },
            { name: 'Alpha Quiz – Question 4', variants: 1, importable: 0, alreadyImported: 0 },
          ],
          existingQuiz: null,
          skipped: [{ slotName: 'Alpha Quiz – Question 4', itemTitle: 'Question', canvasType: 'calculated_question', reason: CALCULATED_REASON }],
          predictedDrafts: [],
          notes: [],
        },
      ],
    });
    for (const name of ['grasp_question', 'grasp_objective', 'grasp_quiz', 'grasp_quiz_question']) {
      expect(fake.docs(name)).toHaveLength(0);
    }
    expect(uploadImage).not.toHaveBeenCalled();
  });

  it('counts questions and the GRASP quiz this course already has from the export', async () => {
    const buffer = await exportZip([alphaQuiz(), betaQuiz()], BUNDLED);
    fake.seed('grasp_question', { courseId: courseObj, source: ALPHA_SOURCE('gitema1', 'ggroupa1') });
    // Orphaned (its objective was deleted): still imported, not created again.
    fake.seed('grasp_question', { courseId: courseObj, source: ALPHA_SOURCE('gitema4', 'gitema4'), orphaned: true });
    // Same Canvas item in another course, or under another Canvas quiz: not this import's.
    fake.seed('grasp_question', { courseId: new ObjectId(OTHER_COURSE_ID), source: ALPHA_SOURCE('gitema2', 'ggroupa1') });
    fake.seed('grasp_question', { courseId: courseObj, source: { ...ALPHA_SOURCE('gitema3', 'ggroupa2'), quizIdent: BETA } });
    const graspQuiz = fake.seed('grasp_quiz', { courseId: courseObj, name: 'Alpha Quiz (renamed)', source: { kind: 'canvas-classic', quizIdent: ALPHA } });

    const report = await previewCanvasImport({ courseId: COURSE_ID, buffer, deps: { imageHosts: HOSTS } });
    const quiz = report.quizzes.find((entry) => entry.ident === ALPHA);

    expect(quiz.importable).toBe(2);
    expect(quiz.alreadyImported).toBe(2);
    expect(quiz.items).toBe(5);
    expect(quiz.slots.map(({ importable, alreadyImported }) => [importable, alreadyImported])).toEqual([
      [1, 1], [1, 0], [0, 1], [0, 0],
    ]);
    expect(quiz.existingQuiz).toEqual({ id: String(graspQuiz._id), name: 'Alpha Quiz (renamed)' });
    expect(report.quizzes.find((entry) => entry.ident === BETA)).toMatchObject({ importable: 1, alreadyImported: 0, existingQuiz: null });
    expect(report.totals).toMatchObject({ items: 7, importable: 3, alreadyImported: 2, skipped: 2 });
    // gitema1's picture is not downloaded again; gitema2 uses the same link.
    expect(report.totals.remoteImages).toBe(2);
  });

  it('counts the imported questions that an import never put in the GRASP quiz', async () => {
    const buffer = await exportZip([alphaQuiz(), betaQuiz()], BUNDLED);
    for (const [itemIdent, slotIdent] of [['gitema1', 'ggroupa1'], ['gitema2', 'ggroupa1'], ['gitema3', 'ggroupa2']]) {
      fake.seed('grasp_question', { courseId: courseObj, source: ALPHA_SOURCE(itemIdent, slotIdent) });
    }
    // Orphaned questions cannot go in a quiz.
    fake.seed('grasp_question', { courseId: courseObj, source: ALPHA_SOURCE('gitema4', 'gitema4'), orphaned: true });
    // Imported without a GRASP quiz: there is no quiz to be missing from.
    fake.seed('grasp_question', { courseId: courseObj, source: { kind: 'canvas-classic', quizIdent: BETA, itemIdent: 'gitemb1', slotIdent: 'gitemb1' } });
    // An import put gitema1 in (whether it is still there is the instructor's
    // business); gitema2 and gitema3 never got there.
    fake.seed('grasp_quiz', {
      courseId: courseObj,
      name: 'Alpha Quiz',
      source: { kind: 'canvas-classic', quizIdent: ALPHA },
      importLinkedItems: ['gitema1'],
    });

    const report = await previewCanvasImport({ courseId: COURSE_ID, buffer, deps: { imageHosts: HOSTS } });

    expect(report.quizzes.map(({ ident, importable, alreadyImported, unlinked }) => ({ ident, importable, alreadyImported, unlinked })))
      .toEqual([
        { ident: BETA, importable: 0, alreadyImported: 1, unlinked: 0 },
        { ident: ALPHA, importable: 0, alreadyImported: 4, unlinked: 2 },
      ]);
  });

  it('predicts the Drafts: lossy conversions and images that cannot be imported', async () => {
    const quiz = {
      ident: 'gquizgamma',
      title: 'Gamma Quiz',
      slots: [
        items.mcItem({
          ident: 'gitemg1',
          choices: [{ ident: '1', text: 'Sodium' }, { ident: '2', text: 'sodium' }, { ident: '3', text: 'Neon' }],
          correct: '1',
        }),
        items.mcItem({
          ident: 'gitemg2',
          stemHtml: '<p>Pick the synthetic structure.</p><p><img src="$IMS-CC-FILEBASE$/assessment_questions/missing.png"></p>',
          choices: [
            { ident: '1', html: '<p><img src="https://images.example.test/a.png" alt="Ring"></p>' },
            { ident: '2', text: 'Chain' },
          ],
          correct: '1',
        }),
      ],
      meta: { shuffleAnswers: false },
    };

    const report = await previewCanvasImport({
      courseId: COURSE_ID,
      buffer: await exportZip([quiz]),
      deps: { imageHosts: HOSTS },
    });

    expect(report.quizzes[0].predictedDrafts).toEqual([
      {
        slotName: 'Gamma Quiz – Question 1',
        title: 'Which synthetic statement is correct?',
        reasons: [
          "Two answer options differ only in capital letters; GRASP's editor asks you to change one before you can save edits.",
        ],
      },
      {
        slotName: 'Gamma Quiz – Question 2',
        title: 'Pick the synthetic structure.',
        reasons: ['An image in the export could not be read.', 'Option A: An image could not be downloaded from Canvas.'],
      },
    ]);
    // A link outside the Canvas allow-list is not counted as a download.
    expect(report.totals).toMatchObject({ remoteImages: 0, bundledImages: 1, predictedDrafts: 2 });
  });

  it('never puts an image link or a package path in the report', async () => {
    const report = await previewCanvasImport({
      courseId: COURSE_ID,
      buffer: await exportZip([alphaQuiz(), betaQuiz()], BUNDLED),
      deps: { imageHosts: HOSTS },
    });

    const text = JSON.stringify(report);
    expect(text).not.toMatch(/https?:|verifier|canvas\.example\.test|IMS-CC-FILEBASE|diagram\.png|\.xml/);
  });

  it('rejects a full course export before reading the course', async () => {
    const buffer = await buildExportZip({
      entries: {
        'imsmanifest.xml': buildManifest({ quizzes: [] }),
        'course_settings/course_settings.xml': '<course/>',
      },
    });

    await expect(previewCanvasImport({ courseId: COURSE_ID, buffer })).rejects.toMatchObject({
      name: 'CanvasImportError',
      code: 'COURSE_EXPORT',
      status: 400,
    });
    expect(databaseService.connect).not.toHaveBeenCalled();
  });
});

// ---- commitCanvasQuiz ------------------------------------------------------------

describe('commitCanvasQuiz', () => {
  it('creates one objective per slot, saves every variant on it and builds an unpublished spaced quiz', async () => {
    const buffer = await exportZip([alphaQuiz(), betaQuiz()], BUNDLED);

    const report = await commit(buffer);

    const graspQuiz = fake.docs('grasp_quiz')[0];
    expect(report).toEqual({
      quizIdent: ALPHA,
      title: 'Alpha Quiz',
      created: { questions: 4, approved: 4, drafts: 0, objectives: 3 },
      alreadyImported: 0,
      skipped: [{ slotName: 'Alpha Quiz – Question 4', itemTitle: 'Question', canvasType: 'calculated_question', reason: CALCULATED_REASON }],
      drafts: [],
      failures: [],
      imageFailures: 0,
      quiz: { id: String(graspQuiz._id), name: 'Alpha Quiz', created: true },
    });

    // One parent per slot with questions, each with one granular of the same name.
    const parents = fake.docs('grasp_objective').filter((doc) => doc.parent === 0);
    expect(parents.map((parent) => [parent.name, parent.source])).toEqual([
      ['Alpha Quiz – Q01', { kind: 'canvas-classic', quizIdent: ALPHA, slotIdent: 'ggroupa1' }],
      ['Alpha Quiz – Q02', { kind: 'canvas-classic', quizIdent: ALPHA, slotIdent: 'ggroupa2' }],
      ['Alpha Quiz – Question 3', { kind: 'canvas-classic', quizIdent: ALPHA, slotIdent: 'gitema4' }],
    ]);
    const granular = parents.map((parent) => {
      const children = childrenOf(parent);
      expect(children.map((child) => child.name)).toEqual([parent.name]);
      expect(children[0].source).toBeUndefined();
      return children[0];
    });

    // Both Q01 variants on the same granular (spaced delivery serves one of them).
    expect(questionBy('gitema1').granularObjectiveId).toEqual(granular[0]._id);
    expect(questionBy('gitema2').granularObjectiveId).toEqual(granular[0]._id);
    expect(questionBy('gitema1').learningObjectiveId).toEqual(parents[0]._id);
    expect(questionBy('gitema3').granularObjectiveId).toEqual(granular[1]._id);
    expect(questionBy('gitema4').granularObjectiveId).toEqual(granular[2]._id);

    expect(questionBy('gitema1')).toMatchObject({
      questionType: 'multiple-choice',
      title: 'Which synthetic salt dissolves first?',
      stem: 'Select the best answer:',
      bloom: 'Understand',
      status: 'Approved',
      createdBy: USER._id,
      courseId: courseObj,
      source: ALPHA_SOURCE('gitema1', 'ggroupa1'),
    });
    expect(questionBy('gitema1')).not.toHaveProperty('importWarnings');
    expect(questionBy('gitema4')).toMatchObject({
      questionType: 'calculation',
      title: 'Synthetic yield',
      calculationFormula: '2.5',
      calculationVariables: [],
      calculationTolerance: { mode: 'absolute', value: 0.2 },
      status: 'Approved',
      source: ALPHA_SOURCE('gitema4', 'gitema4'),
    });

    expect(graspQuiz).toMatchObject({
      courseId: courseObj,
      name: 'Alpha Quiz',
      description: 'Synthetic instructions.',
      published: false,
      deliveryFormat: 'spaced-3phase',
      timeLimitMinutes: 60,
      disablePreviousNavigation: false,
      source: { kind: 'canvas-classic', quizIdent: ALPHA },
    });
    expect(linksOf(graspQuiz._id).sort()).toEqual(
      ['gitema1', 'gitema2', 'gitema3', 'gitema4'].map((ident) => String(questionBy(ident)._id)).sort(),
    );
    // Only the chosen Canvas quiz is imported.
    expect(fake.docs('grasp_question').some((doc) => doc.source.quizIdent === BETA)).toBe(false);
  });

  it('downloads a shared link once and stores a separate copy for each question', async () => {
    const buffer = await exportZip([alphaQuiz()], BUNDLED);
    const fetcher = fakeFetcher({
      [R_SALT]: okImage(png('salt'), 'image/png'),
      [R_CURVE]: okImage(jpeg('curve'), 'image/jpeg'),
    });

    await commit(buffer, { deps: { fetcher } });

    expect(fetcher.fetchImage.mock.calls.map(([url]) => url)).toEqual([R_SALT, R_CURVE]);
    expect(uploadImage.mock.calls.map(([data, options]) => [data, options])).toEqual([
      [png('salt'), { filename: 'canvas-image-1.png', mimeType: 'image/png', courseId: COURSE_ID, uploadedBy: USER._id }],
      [png('salt'), { filename: 'canvas-image-2.png', mimeType: 'image/png', courseId: COURSE_ID, uploadedBy: USER._id }],
      [png('diagram'), { filename: 'canvas-image-3.png', mimeType: 'image/png', courseId: COURSE_ID, uploadedBy: USER._id }],
      [jpeg('curve'), { filename: 'canvas-image-4.jpg', mimeType: 'image/jpeg', courseId: COURSE_ID, uploadedBy: USER._id }],
    ]);

    const image = (n, data, mimeType, caption = '') => ({
      fileId: fileIdOf(n),
      filename: `canvas-image-${n}.${mimeType === 'image/png' ? 'png' : 'jpg'}`,
      mimeType,
      size: data.length,
      caption,
    });
    expect(questionBy('gitema1').stemImages).toEqual([image(1, png('salt'), 'image/png')]);
    expect(questionBy('gitema2').stemImages).toEqual([image(2, png('salt'), 'image/png')]);

    const withPictures = questionBy('gitema3');
    expect(withPictures.stemImages).toEqual([image(3, png('diagram'), 'image/png')]);
    const correct = withPictures.options[withPictures.correctAnswer];
    expect(correct).toEqual({ text: '', feedback: '', image: image(4, jpeg('curve'), 'image/jpeg', 'Rising curve') });
    expect(Object.values(withPictures.options).filter((option) => option.image)).toHaveLength(1);
  });

  it('saves a question whose image failed as a Draft and says why', async () => {
    const buffer = await exportZip([alphaQuiz()], BUNDLED);
    // The shared link expired and the option picture is gone.
    const fetcher = fakeFetcher({ [R_SALT]: { ok: false, reason: 'not-an-image' }, [R_CURVE]: { ok: false, reason: 'http-404' } });

    const report = await commit(buffer, { deps: { fetcher } });

    expect(fetcher.fetchImage).toHaveBeenCalledTimes(2);
    const optionLetter = questionBy('gitema3').correctAnswer;
    const optionWarning = `Option ${optionLetter}: ${IMAGE_WARNINGS.REMOTE}`;
    expect(report.created).toEqual({ questions: 4, approved: 1, drafts: 3, objectives: 3 });
    expect(report.imageFailures).toBe(3);
    expect(report.drafts).toEqual([
      { slotName: 'Alpha Quiz – Q01', title: 'Which synthetic salt dissolves first?', questionId: String(questionBy('gitema1')._id), reasons: [IMAGE_WARNINGS.REMOTE] },
      { slotName: 'Alpha Quiz – Q01', title: 'Which synthetic salt dissolves first?', questionId: String(questionBy('gitema2')._id), reasons: [IMAGE_WARNINGS.REMOTE] },
      { slotName: 'Alpha Quiz – Q02', title: 'Which graph matches the synthetic data?', questionId: String(questionBy('gitema3')._id), reasons: [optionWarning] },
    ]);

    expect(questionBy('gitema1')).toMatchObject({ status: 'Draft', stemImages: [], importWarnings: [IMAGE_WARNINGS.REMOTE] });
    const withPictures = questionBy('gitema3');
    expect(withPictures.status).toBe('Draft');
    expect(withPictures.importWarnings).toEqual([optionWarning]);
    // The empty option would otherwise show nothing at all.
    expect(withPictures.options[optionLetter]).toEqual({ text: '(image unavailable)', feedback: '' });
    expect(withPictures.stemImages).toHaveLength(1);
    expect(questionBy('gitema4').status).toBe('Approved');
  });

  it('saves everything as Draft without warnings when the importer cannot approve', async () => {
    const report = await commit(await exportZip([alphaQuiz()], BUNDLED), { canApprove: false, canCreateQuizzes: false });

    expect(report.created).toEqual({ questions: 4, approved: 0, drafts: 4, objectives: 3 });
    expect(report.drafts).toEqual([]);
    expect(fake.docs('grasp_question').map((doc) => doc.status)).toEqual(['Draft', 'Draft', 'Draft', 'Draft']);
    expect(fake.docs('grasp_question').some((doc) => 'importWarnings' in doc)).toBe(false);
  });

  it('deletes the images of a question that fails to save and reports it', async () => {
    fake.failInsertWhen((name, doc) => name === 'grasp_question' && doc.source.itemIdent === 'gitema3');

    const report = await commit(await exportZip([alphaQuiz()], BUNDLED));

    // gitema3's stem picture and option picture were uploaded third and fourth.
    expect(deleteImages).toHaveBeenCalledTimes(1);
    expect(deleteImages).toHaveBeenCalledWith([fileIdOf(3), fileIdOf(4)]);
    expect(report.failures).toEqual([
      { slotName: 'Alpha Quiz – Q02', title: 'Which graph matches the synthetic data?', reason: 'GRASP could not save this question.' },
    ]);
    expect(report.created).toEqual({ questions: 3, approved: 3, drafts: 0, objectives: 3 });
    expect(questionBy('gitema3')).toBeUndefined();
    expect(linksOf(fake.docs('grasp_quiz')[0]._id)).toHaveLength(3);
  });

  it('imports nothing twice: a second run adds no question, objective, image or link', async () => {
    const buffer = await exportZip([alphaQuiz()], BUNDLED);
    await commit(buffer);
    const counts = () => ['grasp_question', 'grasp_objective', 'grasp_quiz', 'grasp_quiz_question'].map((name) => fake.docs(name).length);
    const before = counts();
    uploadImage.mockClear();
    const fetcher = fakeFetcher({});

    const report = await commit(buffer, { deps: { fetcher } });

    expect(report).toMatchObject({
      created: { questions: 0, approved: 0, drafts: 0, objectives: 0 },
      alreadyImported: 4,
      failures: [],
      imageFailures: 0,
      quiz: null,
    });
    expect(counts()).toEqual(before);
    expect(fetcher.fetchImage).not.toHaveBeenCalled();
    expect(uploadImage).not.toHaveBeenCalled();
  });

  it('adds only the newly saved questions to the GRASP quiz an earlier run created', async () => {
    const buffer = await exportZip([alphaQuiz()], BUNDLED);
    fake.failInsertWhen((name, doc) => name === 'grasp_question' && doc.source.itemIdent === 'gitema3');
    await commit(buffer);
    fake.failInsertWhen(() => false);
    const graspQuiz = fake.docs('grasp_quiz')[0];
    // The instructor took gitema2 out of the quiz; a re-import must not put it back.
    const gitema2 = String(questionBy('gitema2')._id);
    fake.docs('grasp_quiz_question').splice(
      fake.docs('grasp_quiz_question').findIndex((link) => String(link.questionId) === gitema2), 1);

    const report = await commit(buffer);

    expect(report.created).toEqual({ questions: 1, approved: 1, drafts: 0, objectives: 0 });
    expect(report.alreadyImported).toBe(3);
    expect(report.quiz).toEqual({ id: String(graspQuiz._id), name: 'Alpha Quiz', created: false });
    expect(fake.docs('grasp_quiz')).toHaveLength(1);
    // The Q02 objective made by the first run is reused.
    expect(questionBy('gitema3').granularObjectiveId).toEqual(childrenOf(objectiveNamed('Alpha Quiz – Q02'))[0]._id);
    expect(linksOf(graspQuiz._id).sort()).toEqual(
      ['gitema1', 'gitema3', 'gitema4'].map((ident) => String(questionBy(ident)._id)).sort(),
    );
  });

  it('creates the GRASP quiz later from questions imported without one, leaving orphans out', async () => {
    const buffer = await exportZip([alphaQuiz()], BUNDLED);
    await commit(buffer, { createQuiz: false });
    expect(fake.docs('grasp_quiz')).toHaveLength(0);
    // Its objective was deleted with "keep questions".
    fake.docs('grasp_question').find((doc) => doc.source.itemIdent === 'gitema4').orphaned = true;

    const report = await commit(buffer);

    expect(report.created.questions).toBe(0);
    expect(report.alreadyImported).toBe(4);
    const graspQuiz = fake.docs('grasp_quiz')[0];
    expect(report.quiz).toEqual({ id: String(graspQuiz._id), name: 'Alpha Quiz', created: true });
    expect(linksOf(graspQuiz._id).sort()).toEqual(
      ['gitema1', 'gitema2', 'gitema3'].map((ident) => String(questionBy(ident)._id)).sort(),
    );
  });

  it('makes no empty GRASP quiz for a Canvas quiz with nothing to import', async () => {
    const quiz = {
      ident: 'gquizessay',
      title: 'Essay Quiz',
      slots: [items.otherItem({ ident: 'gitemx1' }), items.calculatedItem({ ident: 'gitemx2' })],
    };

    const report = await commit(await exportZip([quiz]), { quizIdent: 'gquizessay' });

    expect(report).toMatchObject({ created: { questions: 0, approved: 0, drafts: 0, objectives: 0 }, quiz: null });
    expect(report.skipped.map((entry) => entry.reason)).toEqual([ESSAY_REASON, CALCULATED_REASON]);
    expect(fake.docs('grasp_quiz')).toHaveLength(0);
    expect(fake.docs('grasp_objective')).toHaveLength(0);
  });

  it('makes no GRASP quiz from questions that are all orphaned', async () => {
    const buffer = await exportZip([alphaQuiz()], BUNDLED);
    await commit(buffer, { createQuiz: false });
    fake.docs('grasp_question').forEach((doc) => {
      doc.orphaned = true;
    });

    const report = await commit(buffer);

    expect(report.alreadyImported).toBe(4);
    expect(report.quiz).toBeNull();
    expect(fake.docs('grasp_quiz')).toHaveLength(0);
  });

  it('makes no GRASP quiz when no question could be saved', async () => {
    fake.failInsertWhen((name) => name === 'grasp_question');

    const report = await commit(await exportZip([alphaQuiz()], BUNDLED));

    expect(report.failures).toHaveLength(4);
    expect(report.quiz).toBeNull();
    expect(fake.docs('grasp_quiz')).toHaveLength(0);
  });

  it('ignores objectives and the GRASP quiz another course made from the same export', async () => {
    const buffer = await exportZip([alphaQuiz(), betaQuiz()], BUNDLED);
    await commit(buffer, { courseId: OTHER_COURSE_ID });
    const otherQuiz = fake.docs('grasp_quiz')[0];
    const otherParents = fake.docs('grasp_objective').filter((doc) => doc.parent === 0);
    const otherLinks = linksOf(otherQuiz._id);

    const report = await commit(buffer);

    expect(report.created.objectives).toBe(3);
    expect(report.quiz).toMatchObject({ created: true });
    expect(report.quiz.id).not.toBe(String(otherQuiz._id));
    expect(linksOf(otherQuiz._id)).toEqual(otherLinks);
    expect(otherParents.flatMap((parent) => childrenOf(parent))).toHaveLength(3);
  });

  it('makes no GRASP quiz when it is not asked for or not allowed', async () => {
    const buffer = await exportZip([alphaQuiz()], BUNDLED);

    const notAsked = await commit(buffer, { createQuiz: false });
    fake = createFakeDb();
    databaseService.connect.mockResolvedValue(fake.db);
    const notAllowed = await commit(buffer, { createQuiz: true, canCreateQuizzes: false });

    expect(notAsked.quiz).toBeNull();
    expect(notAllowed.quiz).toBeNull();
    expect(notAllowed.created.questions).toBe(4);
    expect(fake.docs('grasp_quiz')).toHaveLength(0);
    expect(fake.docs('grasp_quiz_question')).toHaveLength(0);
  });

  it('adds a granular to an imported parent objective that has lost its children', async () => {
    const parent = fake.seed('grasp_objective', {
      name: 'Alpha Quiz – Q01',
      parent: 0,
      courseId: courseObj,
      source: { kind: 'canvas-classic', quizIdent: ALPHA, slotIdent: 'ggroupa1' },
    });

    const report = await commit(await exportZip([alphaQuiz()], BUNDLED));

    const children = childrenOf(parent);
    expect(children.map((child) => child.name)).toEqual(['Alpha Quiz – Q01']);
    expect(questionBy('gitema1').granularObjectiveId).toEqual(children[0]._id);
    expect(questionBy('gitema2').granularObjectiveId).toEqual(children[0]._id);
    expect(report.created.objectives).toBe(2);
    expect(fake.docs('grasp_objective').filter((doc) => doc.name === 'Alpha Quiz – Q01' && doc.parent === 0)).toHaveLength(1);
  });

  it('keeps using the granular an earlier variant is on when the parent has several', async () => {
    const parent = fake.seed('grasp_objective', {
      name: 'Alpha Quiz – Q01',
      parent: 0,
      courseId: courseObj,
      source: { kind: 'canvas-classic', quizIdent: ALPHA, slotIdent: 'ggroupa1' },
    });
    fake.seed('grasp_objective', { name: 'Added by the instructor', parent: parent._id, courseId: courseObj });
    const original = fake.seed('grasp_objective', { name: 'Alpha Quiz – Q01', parent: parent._id, courseId: courseObj });
    fake.seed('grasp_question', { courseId: courseObj, granularObjectiveId: original._id, source: ALPHA_SOURCE('gitema1', 'ggroupa1') });

    await commit(await exportZip([alphaQuiz()], BUNDLED));

    expect(questionBy('gitema2').granularObjectiveId).toEqual(original._id);
    expect(childrenOf(parent)).toHaveLength(2);
  });

  it('gives a new objective a free name when the course already uses it', async () => {
    fake.seed('grasp_objective', { name: 'alpha quiz – q01', parent: 0, courseId: courseObj });
    fake.seed('grasp_objective', { name: 'Alpha Quiz – Q01 (2)', parent: 0, courseId: courseObj });
    // Another course's objectives do not matter.
    fake.seed('grasp_objective', { name: 'Alpha Quiz – Q02', parent: 0, courseId: new ObjectId(OTHER_COURSE_ID) });

    await commit(await exportZip([alphaQuiz()], BUNDLED));

    const imported = fake.docs('grasp_objective').filter((doc) => doc.source);
    expect(imported.map((doc) => doc.name)).toEqual(['Alpha Quiz – Q01 (3)', 'Alpha Quiz – Q02', 'Alpha Quiz – Question 3']);
    expect(childrenOf(imported[0]).map((child) => child.name)).toEqual(['Alpha Quiz – Q01 (3)']);
  });

  it('saves both variants that differ only by their picture (no text de-duplication)', async () => {
    const R_A = remote(21);
    const R_B = remote(22);
    const quiz = {
      ident: 'gquiztwins',
      title: 'Twins Quiz',
      meta: { shuffleAnswers: false },
      slots: [
        items.groupSection({
          ident: 'ggroupt1',
          title: 'Q01',
          items: [
            items.mcItem({ ident: 'gitemt1', stemHtml: `<p>Name the synthetic compound shown.</p><p><img src="${R_A}"></p>` }),
            items.mcItem({ ident: 'gitemt2', stemHtml: `<p>Name the synthetic compound shown.</p><p><img src="${R_B}"></p>` }),
          ],
        }),
      ],
    };
    const fetcher = fakeFetcher({ [R_A]: okImage(png('a'), 'image/png'), [R_B]: okImage(png('b'), 'image/png') });

    const report = await commit(await exportZip([quiz]), { quizIdent: 'gquiztwins', deps: { fetcher } });

    expect(report.created.questions).toBe(2);
    const [first, second] = ['gitemt1', 'gitemt2'].map(questionBy);
    for (const field of ['title', 'stem', 'options', 'correctAnswer', 'granularObjectiveId']) {
      expect(second[field]).toEqual(first[field]);
    }
    expect(first.stemImages[0].size).toBe(png('a').length);
    expect(second.stemImages[0].size).toBe(png('b').length);
  });

  it('stores inline data: images and reports unreadable ones from the export', async () => {
    const inline = `data:image/png;base64,${png('inline').toString('base64')}`;
    const notAnImage = `data:image/png;base64,${Buffer.from('<html>not an image</html>').toString('base64')}`;
    const quiz = {
      ident: 'gquizdelta',
      title: 'Delta Quiz',
      slots: [
        items.mcItem({ ident: 'gitemd1', stemHtml: `<p>Inline picture.</p><p><img src="${inline}"></p>` }),
        items.mcItem({ ident: 'gitemd2', stemHtml: `<p>Broken picture.</p><p><img src="${notAnImage}"></p>` }),
        items.mcItem({ ident: 'gitemd3', stemHtml: '<p>Missing picture.</p><p><img src="$IMS-CC-FILEBASE$/nowhere.png"></p>' }),
      ],
    };

    const report = await commit(await exportZip([quiz]), { quizIdent: 'gquizdelta' });

    expect(uploadImage).toHaveBeenCalledTimes(1);
    expect(uploadImage.mock.calls[0][0]).toEqual(png('inline'));
    expect(questionBy('gitemd1').status).toBe('Approved');
    expect(questionBy('gitemd2').importWarnings).toEqual([IMAGE_WARNINGS.EXPORT]);
    expect(questionBy('gitemd3').importWarnings).toEqual([IMAGE_WARNINGS.EXPORT]);
    expect(report.imageFailures).toBe(2);
  });

  it('does not store an image over the per-image size cap', async () => {
    const buffer = await exportZip([alphaQuiz()], BUNDLED);
    // The downloaded pictures fit; the bundled diagram is larger.
    const maxImageBytes = Math.max(png('salt').length, jpeg('curve').length);
    expect(png('diagram').length).toBeGreaterThan(maxImageBytes);

    await commit(buffer, { deps: { limits: { maxImageBytes } } });

    expect(questionBy('gitema3')).toMatchObject({ importWarnings: [IMAGE_WARNINGS.EXPORT], status: 'Draft' });
    expect(questionBy('gitema3').stemImages).toEqual([]);
    expect(questionBy('gitema1').status).toBe('Approved');
  });

  it('stops downloading at the per-quiz image limits', async () => {
    const buffer = await exportZip([alphaQuiz()], BUNDLED);
    const fetcher = fakeFetcher({
      [R_SALT]: okImage(png('salt'), 'image/png'),
      [R_CURVE]: okImage(jpeg('curve'), 'image/jpeg'),
    });

    await commit(buffer, { deps: { fetcher, limits: { maxRemoteImages: 1 } } });

    expect(fetcher.fetchImage.mock.calls.map(([url]) => url)).toEqual([R_SALT]);
    const letter = questionBy('gitema3').correctAnswer;
    expect(questionBy('gitema3').importWarnings).toEqual([`Option ${letter}: ${IMAGE_WARNINGS.TOO_MANY}`]);
    expect(questionBy('gitema1').status).toBe('Approved');
  });

  it('stops storing copies once the quiz has used its image bytes', async () => {
    const buffer = await exportZip([alphaQuiz()], BUNDLED);
    // Room for the shared picture once, not twice.
    const limit = png('salt').length + 5;

    await commit(buffer, { deps: { limits: { maxImageBytesPerQuiz: limit, fetchConcurrency: 1 } } });

    expect(questionBy('gitema1').stemImages).toHaveLength(1);
    expect(questionBy('gitema2')).toMatchObject({ stemImages: [], importWarnings: [IMAGE_WARNINGS.TOO_MANY], status: 'Draft' });
  });

  it('stops downloading once the quiz has fetched its image bytes', async () => {
    const buffer = await exportZip([alphaQuiz()], BUNDLED);
    const fetcher = fakeFetcher({
      [R_SALT]: okImage(png('salt'), 'image/png'),
      [R_CURVE]: okImage(jpeg('curve'), 'image/jpeg'),
    });

    await commit(buffer, { deps: { fetcher, limits: { maxImageBytesPerQuiz: png('salt').length, fetchConcurrency: 1 } } });

    // The second link is never requested. (gitema3's warnings are not checked:
    // the same cap also refuses its bundled diagram.)
    expect(fetcher.fetchImage.mock.calls.map(([url]) => url)).toEqual([R_SALT]);
    expect(questionBy('gitema1').stemImages).toHaveLength(1);
  });

  it('treats links not yet requested when the time budget runs out as failed downloads', async () => {
    const buffer = await exportZip([alphaQuiz()], BUNDLED);
    const fetcher = fakeFetcher({ [R_SALT]: okImage(png('salt'), 'image/png') });

    const report = await commit(buffer, { deps: { fetcher, limits: { fetchBudgetMs: 0 } } });

    expect(fetcher.fetchImage).not.toHaveBeenCalled();
    expect(questionBy('gitema1').importWarnings).toEqual([IMAGE_WARNINGS.REMOTE]);
    expect(report.imageFailures).toBe(3);
  });

  it('refuses a quiz ident that is not in the export', async () => {
    const buffer = await exportZip([alphaQuiz()], BUNDLED);

    await expect(commit(buffer, { quizIdent: 'gnotthere' })).rejects.toMatchObject({
      name: 'CanvasImportError',
      code: 'UNKNOWN_QUIZ',
      status: 400,
      message: "This quiz isn't in the uploaded export. Upload the export again and choose from its quizzes.",
    });
    expect(databaseService.connect).not.toHaveBeenCalled();
  });

  it('keeps every image link out of saved questions, reports, file names and logs', async () => {
    const buffer = await exportZip([alphaQuiz()], BUNDLED);
    const fetcher = fakeFetcher({ [R_SALT]: okImage(png('salt'), 'image/png') });

    const report = await commit(buffer, { deps: { fetcher } });

    const leaks = /https?:|verifier|canvas\.example\.test|IMS-CC-FILEBASE/;
    expect(JSON.stringify(report)).not.toMatch(leaks);
    expect(JSON.stringify(fake.docs('grasp_question'))).not.toMatch(leaks);
    expect(JSON.stringify(fake.docs('grasp_objective'))).not.toMatch(leaks);
    expect(JSON.stringify(fake.docs('grasp_quiz'))).not.toMatch(leaks);
    expect(JSON.stringify(uploadImage.mock.calls.map(([, options]) => options))).not.toMatch(leaks);
    expect(consoleOutput.join('\n')).not.toMatch(leaks);
    // saveQuestion logged each payload, so the check above saw them.
    expect(consoleOutput.filter((line) => line.startsWith('"Saving question:"'))).toHaveLength(4);
  });
});

// ---- commitCanvasQuiz: one commit per Canvas quiz at a time ---------------------

describe('commitCanvasQuiz lock', () => {
  const LOCK_ID = `${COURSE_ID}:${ALPHA}`;
  const IN_PROGRESS = {
    name: 'CanvasImportError',
    code: 'IMPORT_IN_PROGRESS',
    status: 409,
    message: 'This Canvas quiz is already being imported. Try again in a minute.',
  };
  const locks = () => fake.docs('grasp_canvas_import_lock');
  const counts = () => ['grasp_question', 'grasp_objective', 'grasp_quiz', 'grasp_quiz_question'].map((name) => fake.docs(name).length);

  it('refuses a second commit of the same quiz while the first runs', async () => {
    const buffer = await exportZip([alphaQuiz()], BUNDLED);

    const [first, second] = await Promise.allSettled([commit(buffer), commit(buffer)]);

    expect(first.status).toBe('fulfilled');
    expect(first.value.created.questions).toBe(4);
    expect(second.status).toBe('rejected');
    expect(second.reason).toMatchObject(IN_PROGRESS);
    // Only the first commit's questions, objectives, quiz, links and uploads.
    expect(counts()).toEqual([4, 6, 1, 4]);
    expect(uploadImage).toHaveBeenCalledTimes(4);
    expect(locks()).toEqual([]);
  });

  it('writes and downloads nothing when the quiz is locked', async () => {
    const live = {
      _id: LOCK_ID,
      owner: new ObjectId(),
      startedAt: new Date('2999-01-01T00:00:00Z'),
      expiresAt: new Date('2999-01-01T00:15:00Z'),
    };
    fake.seed('grasp_canvas_import_lock', live);
    const fetcher = fakeFetcher({ [R_SALT]: okImage(png('salt'), 'image/png') });

    await expect(commit(await exportZip([alphaQuiz()], BUNDLED), { deps: { fetcher } })).rejects.toMatchObject(IN_PROGRESS);

    expect(counts()).toEqual([0, 0, 0, 0]);
    expect(fetcher.fetchImage).not.toHaveBeenCalled();
    expect(uploadImage).not.toHaveBeenCalled();
    // The running commit keeps its lock.
    expect(locks()).toEqual([live]);
  });

  it('locks only that quiz in that course', async () => {
    const buffer = await exportZip([alphaQuiz(), betaQuiz()], BUNDLED);
    fake.seed('grasp_canvas_import_lock', { _id: `${OTHER_COURSE_ID}:${ALPHA}`, expiresAt: new Date('2999-01-01T00:00:00Z') });
    fake.seed('grasp_canvas_import_lock', { _id: `${COURSE_ID}:${BETA}`, expiresAt: new Date('2999-01-01T00:00:00Z') });

    const report = await commit(buffer);

    expect(report.created.questions).toBe(4);
    expect(locks().map((lock) => lock._id)).toEqual([`${OTHER_COURSE_ID}:${ALPHA}`, `${COURSE_ID}:${BETA}`]);
  });

  it('takes over the expired lock of a commit that died', async () => {
    fake.seed('grasp_canvas_import_lock', {
      _id: LOCK_ID,
      owner: new ObjectId(),
      startedAt: new Date('2020-01-01T00:00:00Z'),
      expiresAt: new Date('2020-01-01T00:15:00Z'),
    });

    const report = await commit(await exportZip([alphaQuiz()], BUNDLED));

    expect(report.created.questions).toBe(4);
    expect(locks()).toEqual([]);
  });

  it('holds a 15-minute lock while it works and releases it when done', async () => {
    const buffer = await exportZip([alphaQuiz()], BUNDLED);
    const held = [];
    const fetcher = {
      fetchImage: jest.fn(async () => {
        held.push(locks().map(({ _id, startedAt, expiresAt }) => ({ _id, ms: expiresAt - startedAt })));
        return okImage(png('salt'), 'image/png');
      }),
    };

    await commit(buffer, { deps: { fetcher } });

    expect(held[0]).toEqual([{ _id: LOCK_ID, ms: 15 * 60 * 1000 }]);
    expect(locks()).toEqual([]);
    await expect(commit(buffer)).resolves.toMatchObject({ alreadyImported: 4 });
  });

  it('releases the lock when the commit fails part-way', async () => {
    fake.failInsertWhen((name, doc) => name === 'grasp_objective' && doc.source?.slotIdent === 'ggroupa2');

    await expect(commit(await exportZip([alphaQuiz()], BUNDLED))).rejects.toThrow('insert failed');

    expect(locks()).toEqual([]);
  });

  it('does not release a lock another commit took over after its own expired', async () => {
    const successor = { _id: LOCK_ID, owner: new ObjectId(), expiresAt: new Date('2999-01-01T00:15:00Z') };
    const fetcher = {
      fetchImage: jest.fn(async () => {
        locks().splice(0, locks().length, successor);
        return okImage(png('salt'), 'image/png');
      }),
    };

    await commit(await exportZip([alphaQuiz()], BUNDLED), { deps: { fetcher } });

    expect(locks()).toEqual([successor]);
  });
});

// ---- commitCanvasQuiz: the GRASP quiz after an interrupted run ------------------

describe('commitCanvasQuiz after an interrupted run', () => {
  // A first import that saves gitema3 but cannot put it in the GRASP quiz,
  // and so stops before gitema4.
  async function interruptedImport(buffer) {
    fake.failInsertWhen((name, doc) => name === 'grasp_quiz_question'
      && String(doc.questionId) === String(questionBy('gitema3')?._id));
    await expect(commit(buffer)).rejects.toThrow('insert failed');
    fake.failInsertWhen(() => false);
  }

  it('records which Canvas items it put in the GRASP quiz, outside its source', async () => {
    await commit(await exportZip([alphaQuiz()], BUNDLED));

    const [graspQuiz] = fake.docs('grasp_quiz');
    expect(graspQuiz.importLinkedItems).toEqual(['gitema1', 'gitema2', 'gitema3', 'gitema4']);
    expect(graspQuiz.source).toEqual({ kind: 'canvas-classic', quizIdent: ALPHA });
  });

  it('has put each finished slot in the GRASP quiz when a later slot fails', async () => {
    const buffer = await exportZip([alphaQuiz()], BUNDLED);
    fake.failInsertWhen((name, doc) => name === 'grasp_objective' && doc.source?.slotIdent === 'ggroupa2');

    await expect(commit(buffer)).rejects.toThrow('insert failed');

    const [graspQuiz] = fake.docs('grasp_quiz');
    expect(fake.docs('grasp_quiz')).toHaveLength(1);
    expect(linksOf(graspQuiz._id).sort()).toEqual(idsOf('gitema1', 'gitema2'));

    fake.failInsertWhen(() => false);
    const report = await commit(buffer);

    expect(report.created.questions).toBe(2);
    expect(report.quiz).toEqual({ id: String(graspQuiz._id), name: 'Alpha Quiz', created: false });
    expect(fake.docs('grasp_quiz')).toHaveLength(1);
    expect(linksOf(graspQuiz._id).sort()).toEqual(idsOf('gitema1', 'gitema2', 'gitema3', 'gitema4'));
  });

  it('still puts what it saved in the GRASP quiz when a slot stops half-way', async () => {
    // gitema2 fails to save, and deleting its uploaded picture fails too.
    fake.failInsertWhen((name, doc) => name === 'grasp_question' && doc.source.itemIdent === 'gitema2');
    deleteImages.mockRejectedValue(new Error('image store unavailable'));

    await expect(commit(await exportZip([alphaQuiz()], BUNDLED))).rejects.toThrow('image store unavailable');

    const [graspQuiz] = fake.docs('grasp_quiz');
    expect(linksOf(graspQuiz._id)).toEqual(idsOf('gitema1'));
    expect(graspQuiz.importLinkedItems).toEqual(['gitema1']);
  });

  it('adds on a later commit the questions a run saved but could not put in the GRASP quiz', async () => {
    const buffer = await exportZip([alphaQuiz()], BUNDLED);
    await interruptedImport(buffer);
    const [graspQuiz] = fake.docs('grasp_quiz');
    expect(linksOf(graspQuiz._id).sort()).toEqual(idsOf('gitema1', 'gitema2'));
    expect(await previewAlpha(buffer)).toEqual({ importable: 1, alreadyImported: 3, unlinked: 1 });

    const report = await commit(buffer);

    expect(report.created.questions).toBe(1);
    expect(report.alreadyImported).toBe(3);
    expect(report.quiz).toEqual({ id: String(graspQuiz._id), name: 'Alpha Quiz', created: false });
    expect(fake.docs('grasp_quiz')).toHaveLength(1);
    expect(linksOf(graspQuiz._id).sort()).toEqual(idsOf('gitema1', 'gitema2', 'gitema3', 'gitema4'));
    expect(await previewAlpha(buffer)).toEqual({ importable: 0, alreadyImported: 4, unlinked: 0 });
  });

  it('does not put back a question the instructor took out while it adds the missing ones', async () => {
    const buffer = await exportZip([alphaQuiz()], BUNDLED);
    await interruptedImport(buffer);
    const [graspQuiz] = fake.docs('grasp_quiz');
    const links = fake.docs('grasp_quiz_question');
    links.splice(links.findIndex((link) => String(link.questionId) === String(questionBy('gitema2')._id)), 1);
    expect(await previewAlpha(buffer)).toEqual({ importable: 1, alreadyImported: 3, unlinked: 1 });

    await commit(buffer);

    expect(linksOf(graspQuiz._id).sort()).toEqual(idsOf('gitema1', 'gitema3', 'gitema4'));
    expect(await previewAlpha(buffer)).toEqual({ importable: 0, alreadyImported: 4, unlinked: 0 });
  });

  it('fills a GRASP quiz that an interrupted import left empty', async () => {
    const buffer = await exportZip([alphaQuiz()], BUNDLED);
    await commit(buffer, { createQuiz: false });
    // The quiz was created, then the run stopped before linking anything.
    const empty = fake.seed('grasp_quiz', { courseId: courseObj, name: 'Alpha Quiz', source: { kind: 'canvas-classic', quizIdent: ALPHA } });
    expect(await previewAlpha(buffer)).toEqual({ importable: 0, alreadyImported: 4, unlinked: 4 });

    const report = await commit(buffer);

    expect(report.created.questions).toBe(0);
    expect(report.quiz).toEqual({ id: String(empty._id), name: 'Alpha Quiz', created: false });
    expect(fake.docs('grasp_quiz')).toHaveLength(1);
    expect(linksOf(empty._id).sort()).toEqual(idsOf('gitema1', 'gitema2', 'gitema3', 'gitema4'));
  });
});

// ---- commitCanvasQuiz: "Create a GRASP quiz" left off when one already exists ----

describe('commitCanvasQuiz without adding to the existing GRASP quiz', () => {
  // Alpha with other variants in its Q01 group.
  const alphaWithQ01 = (...itemIdents) => {
    const quiz = alphaQuiz();
    quiz.slots[0] = items.groupSection({
      ident: 'ggroupa1',
      title: 'Q01',
      items: itemIdents.map((ident) => items.mcItem({ ident, stemHtml: SALT_STEM })),
    });
    return quiz;
  };
  const decidedItems = (graspQuiz) => [...graspQuiz.importLinkedItems].sort();

  // An instructor imported an older export of Alpha, with its GRASP quiz,
  // before gitema2 was added to Q01.
  async function importOlderExport() {
    await commit(await exportZip([alphaWithQ01('gitema1')], BUNDLED));
    const [graspQuiz] = fake.docs('grasp_quiz');
    expect(decidedItems(graspQuiz)).toEqual(['gitema1', 'gitema3', 'gitema4']);
    return graspQuiz;
  }

  it('keeps what an instructor imported without adding out of the GRASP quiz on later commits too', async () => {
    const graspQuiz = await importOlderExport();
    const buffer = await exportZip([alphaQuiz()], BUNDLED);

    const declined = await commit(buffer, { createQuiz: false });

    expect(declined).toMatchObject({ created: { questions: 1 }, alreadyImported: 3, quiz: null });
    expect(linksOf(graspQuiz._id).sort()).toEqual(idsOf('gitema1', 'gitema3', 'gitema4'));
    expect(decidedItems(graspQuiz)).toEqual(['gitema1', 'gitema2', 'gitema3', 'gitema4']);
    expect(await previewAlpha(buffer)).toEqual({ importable: 0, alreadyImported: 4, unlinked: 0 });

    // Uploading the export again, for example to import another quiz.
    const later = await commit(buffer);

    expect(later).toMatchObject({ created: { questions: 0 }, alreadyImported: 4, quiz: null });
    expect(fake.docs('grasp_quiz')).toHaveLength(1);
    expect(linksOf(graspQuiz._id).sort()).toEqual(idsOf('gitema1', 'gitema3', 'gitema4'));
  });

  it('records each question as it is saved, so a run that stops part-way keeps the choice', async () => {
    const graspQuiz = await importOlderExport();
    const buffer = await exportZip([alphaWithQ01('gitema1', 'gitema2', 'gitema6')], BUNDLED);
    // gitema6 fails to save, and deleting its uploaded picture fails too.
    fake.failInsertWhen((name, doc) => name === 'grasp_question' && doc.source.itemIdent === 'gitema6');
    deleteImages.mockRejectedValue(new Error('image store unavailable'));

    await expect(commit(buffer, { createQuiz: false })).rejects.toThrow('image store unavailable');

    expect(decidedItems(graspQuiz)).toEqual(['gitema1', 'gitema2', 'gitema3', 'gitema4']);
    expect(await previewAlpha(buffer)).toEqual({ importable: 1, alreadyImported: 4, unlinked: 0 });

    // Only what that run saved is recorded: gitema6 is new to a later commit.
    fake.failInsertWhen(() => false);
    deleteImages.mockResolvedValue(undefined);
    await commit(buffer);

    expect(linksOf(graspQuiz._id).sort()).toEqual(idsOf('gitema1', 'gitema3', 'gitema4', 'gitema6'));
  });

  it('still offers what someone who cannot create quizzes imported', async () => {
    const graspQuiz = await importOlderExport();
    const buffer = await exportZip([alphaQuiz()], BUNDLED);

    // A TA's commit never asks for the GRASP quiz: that is no choice to leave gitema2 out.
    const byTa = await commit(buffer, { createQuiz: false, canApprove: false, canCreateQuizzes: false });

    expect(byTa).toMatchObject({ created: { questions: 1, drafts: 1 }, quiz: null });
    expect(decidedItems(graspQuiz)).toEqual(['gitema1', 'gitema3', 'gitema4']);
    expect(await previewAlpha(buffer)).toEqual({ importable: 0, alreadyImported: 4, unlinked: 1 });

    const byInstructor = await commit(buffer);

    expect(byInstructor.quiz).toEqual({ id: String(graspQuiz._id), name: 'Alpha Quiz', created: false });
    expect(linksOf(graspQuiz._id).sort()).toEqual(idsOf('gitema1', 'gitema2', 'gitema3', 'gitema4'));
  });
});
