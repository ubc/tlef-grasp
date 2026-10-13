/**
 * Round trip (#140): GRASP's own Canvas (QTI) export, read back by the Canvas
 * quiz import. A quiz an instructor exported from GRASP to Canvas should come
 * back as the same questions: multiple choice with 2 to 8 options (shuffled
 * once, the correct answer following its option), option and stem images as
 * references into the zip, and fill-in-the-blank (exported as a Canvas short
 * answer) with its accepted answers.
 *
 * The QTI comes from the real export code (createQTIExport); the manifest and
 * zip come from the Canvas fixture builders, laid out the way the export's
 * zip is (images under web_resources/grasp/). Math.random is replaced so the
 * export's random idents, and so the import's seeded shuffle, are repeatable.
 */

const { createQTIExport } = require('../../src/controllers/question');
const { readCanvasPackage } = require('../../src/utils/canvas-qti-package');
const { parseCanvasQuiz } = require('../../src/utils/canvas-qti-parse');
const { mapCanvasQuizzes } = require('../../src/utils/canvas-qti-map');
const { MC_OPTION_KEYS } = require('../../src/utils/mc-options');
const { buildManifest, buildExportZip } = require('../fixtures/canvas-qti/zip');
const { metaXml } = require('../fixtures/canvas-qti/items');

const QUIZ = 'groundtrip0001';
const QUIZ_TITLE = 'Round Trip Quiz';

// Synthetic bytes with a PNG signature; nothing here decodes them.
const imageBytes = (n) => Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from(`synthetic image ${n}`),
]);

function imageRef(n, caption) {
  return {
    fileId: `5f00000000000000000000${String(n).padStart(2, '0')}`,
    filename: `figure ${n}.png`,
    mimeType: 'image/png',
    size: imageBytes(n).length,
    caption,
  };
}

// Where GRASP's QTI export puts an image and how its HTML points at it
// (prepareQTIExportImages in src/controllers/question.js).
function exportedImage(ref) {
  const name = `${ref.fileId}-${ref.filename.replace(/[^A-Za-z0-9._-]/g, '_')}`;
  return {
    zipPath: `web_resources/grasp/${name}`,
    src: `$IMS-CC-FILEBASE$/grasp/${encodeURIComponent(name)}`,
    bytes: imageBytes(Number(ref.fileId.slice(-2))),
  };
}

function refsOf(question) {
  const refs = [...(question.stemImages || [])];
  Object.values(question.options || {}).forEach((option) => option.image && refs.push(option.image));
  return refs;
}

async function exportThenImport(questions) {
  const refs = new Map(questions.flatMap(refsOf).map((ref) => [ref.fileId, ref]));
  const images = new Map([...refs.values()].map((ref) => [ref.fileId, exportedImage(ref)]));
  const imageMap = new Map([...images].map(([fileId, image]) => [fileId, { src: image.src, mimeType: 'image/png' }]));

  const entries = {
    'imsmanifest.xml': buildManifest({ quizzes: [{ ident: QUIZ }], files: [...images.values()].map((image) => image.zipPath) }),
    [`${QUIZ}/${QUIZ}.xml`]: createQTIExport(QUIZ_TITLE, questions, QUIZ, imageMap),
    // GRASP's export writes shuffle_answers true, as here.
    [`${QUIZ}/assessment_meta.xml`]: metaXml({ ident: QUIZ, title: QUIZ_TITLE, description: '' }),
  };
  images.forEach((image) => {
    entries[image.zipPath] = image.bytes;
  });

  const pkg = readCanvasPackage(await buildExportZip({ entries }));
  const [quiz] = mapCanvasQuizzes(pkg.quizzes.map(({ ident, xml, metaXml: meta }) => parseCanvasQuiz({ ident, xml, metaXml: meta })));
  // What the import service will do with each image reference.
  const bytesOf = (src) => {
    const file = pkg.resolveFile(src, { fromPath: pkg.quizzes[0].xmlPath });
    return file ? file.data : null;
  };
  return { quiz, drafts: quiz.slots.flatMap((slot) => slot.questions), bytesOf };
}

// One MC option as a student sees it: text, picture and alt text.
const optionView = (text, bytes, caption) => `${text}|${bytes ? bytes.toString('hex') : '-'}|${caption}`;

function mcQuestion(count, extra = {}) {
  const options = {};
  MC_OPTION_KEYS.slice(0, count).forEach((key, i) => {
    options[key] = { text: `Synthetic choice ${count}.${i + 1}`, feedback: '' };
  });
  // A: text and a picture with a descriptive caption. Last: picture only,
  // captioned with a filename (which the import drops as alt text).
  options.A.image = imageRef(count * 10 + 1, 'Synthetic diagram with labels');
  const last = MC_OPTION_KEYS[count - 1];
  options[last] = { text: '', feedback: '', image: imageRef(count * 10 + 2, 'opt.png') };
  return {
    questionType: 'multiple-choice',
    title: `Which synthetic choice is right among ${count}? (x < y & z)`,
    stem: 'Select the best answer:',
    options,
    correctAnswer: MC_OPTION_KEYS[Math.floor(count / 2)],
    ...extra,
  };
}

describe('GRASP QTI export -> Canvas import round trip', () => {
  let calls;

  beforeEach(() => {
    // Golden-ratio steps: repeatable, and no two of an item's answer ids alike.
    calls = 0;
    jest.spyOn(Math, 'random').mockImplementation(() => {
      calls += 1;
      return (calls * 0.6180339887498949) % 1;
    });
  });

  afterEach(() => {
    Math.random.mockRestore();
  });

  test('multiple choice with 2 to 8 options comes back with the same options, images and correct answer', async () => {
    const originals = [2, 3, 4, 5, 6, 7, 8].map((count) => mcQuestion(count));
    const { quiz, drafts, bytesOf } = await exportThenImport(originals);

    expect(quiz.skipped).toEqual([]);
    expect(quiz.slots.map((slot) => slot.name)).toEqual(originals.map((_, i) => `${QUIZ_TITLE} – Question ${i + 1}`));
    let reordered = 0;
    drafts.forEach((draft, i) => {
      const original = originals[i];
      const letters = Object.keys(original.options);
      const before = letters.map((key) => {
        const { text, image } = original.options[key];
        const caption = image && image.caption !== 'opt.png' ? image.caption : '';
        return optionView(text, image ? exportedImage(image).bytes : null, caption);
      });
      const after = letters.map((key) => {
        const image = draft.optionImages[key];
        return optionView(draft.payload.options[key].text, image ? bytesOf(image.src) : null, image ? image.caption : '');
      });

      expect(draft.payload.questionType).toBe('multiple-choice');
      expect(draft.payload.title).toBe(original.title);
      expect(draft.payload.stem).toBe('Select the best answer:');
      expect(Object.keys(draft.payload.options)).toEqual(letters);
      expect([...after].sort()).toEqual([...before].sort());
      // The correct answer is the same option, wherever the shuffle put it.
      expect(after[letters.indexOf(draft.payload.correctAnswer)]).toBe(before[letters.indexOf(original.correctAnswer)]);
      expect(Object.values(draft.payload.options).every((option) => option.feedback === '')).toBe(true);
      expect(draft.stemImages).toEqual([]);
      expect(draft.warnings).toEqual([]);
      if (after.join() !== before.join()) reordered += 1;
    });
    // The shuffle really ran, so the correct-answer check above means something.
    expect(reordered).toBeGreaterThan(0);
  });

  test('a stem image keeps its caption, without the caption paragraph in the question text', async () => {
    const original = mcQuestion(4, { stemImages: [imageRef(91, 'Cell diagram')] });
    const { drafts, bytesOf } = await exportThenImport([original]);
    const [draft] = drafts;

    expect(draft.payload.title).toBe(original.title);
    expect(draft.stemImages).toHaveLength(1);
    expect(draft.stemImages[0]).toMatchObject({ kind: 'bundled', caption: 'Cell diagram', altText: 'Cell diagram' });
    expect(bytesOf(draft.stemImages[0].src)).toEqual(imageBytes(91));
    expect(draft.warnings).toEqual([]);
  });

  test('several stem images come back numbered, each keeping its caption', async () => {
    const original = mcQuestion(3, { stemImages: [imageRef(92, 'Before heating'), imageRef(93, 'After heating')] });
    const { drafts, bytesOf } = await exportThenImport([original]);
    const [draft] = drafts;

    expect(draft.payload.title).toBe(`${original.title}\n(Image 1)\n(Image 2)`);
    expect(draft.stemImages.map((image) => image.caption)).toEqual(['Image 1: Before heating', 'Image 2: After heating']);
    expect(draft.stemImages.map((image) => bytesOf(image.src))).toEqual([imageBytes(92), imageBytes(93)]);
  });

  test('fill-in-the-blank comes back from its Canvas short answer with every accepted answer', async () => {
    const original = {
      questionType: 'fill-in-the-blank',
      title: 'Powerhouse',
      stem: 'The _________ is the powerhouse of the synthetic cell.',
      correctAnswer: 'mitochondrion',
      acceptableAnswers: ['mitochondrion', 'mitochondria', 'Mitochondria'],
      stemImages: [imageRef(94, 'Cell diagram')],
    };
    const { drafts, bytesOf } = await exportThenImport([original]);
    const [draft] = drafts;

    expect(draft.payload).toEqual({
      questionType: 'fill-in-the-blank',
      // The export writes every item title as "Question", so the slot name is used.
      title: `${QUIZ_TITLE} – Question 1`,
      stem: original.stem,
      bloom: 'Understand',
      correctAnswer: 'mitochondrion',
      // GRASP grading ignores case, so one spelling per answer is kept.
      acceptableAnswers: ['mitochondrion', 'mitochondria'],
    });
    expect(draft.stemImages[0].caption).toBe('Cell diagram');
    expect(bytesOf(draft.stemImages[0].src)).toEqual(imageBytes(94));
    expect(draft.warnings).toEqual([]);
  });

  test('an open-ended question exported as a Canvas essay is listed as skipped', async () => {
    const { quiz, drafts } = await exportThenImport([
      mcQuestion(2),
      {
        questionType: 'open-ended',
        title: 'Explain',
        stem: 'Explain the synthetic result.',
        openEndedSampleAnswer: 'A synthetic answer.',
        openEndedGradingCriteria: 'Mentions the synthetic cause.',
      },
    ]);

    expect(drafts).toHaveLength(1);
    expect(quiz.skipped).toEqual([{
      itemIdent: expect.any(String),
      slotName: `${QUIZ_TITLE} – Question 2`,
      itemTitle: 'Question',
      canvasType: 'essay_question',
      reason: "Essay questions aren't imported yet: GRASP needs a sample answer and grading criteria for them.",
    }]);
  });
});
