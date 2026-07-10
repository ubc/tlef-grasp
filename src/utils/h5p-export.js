const crypto = require('crypto');
const { QUESTION_TYPES } = require('../constants/app-constants');
const {
  normalizeQuestionType,
  getQuestionText,
  getOptionText,
  getOptionFeedback,
  getCorrectAnswerIndex,
  getAcceptableAnswers,
  stemImagesOf,
} = require('./question-export-helpers');

// H5P export: builds the two JSON documents of a .h5p package (a ZIP with
// h5p.json at the root and content/content.json). The whole quiz exports as a
// single H5P Question Set; per-type mapping of its sub-questions:
//   multiple-choice   -> H5P.MultiChoice
//   fill-in-the-blank -> H5P.Blanks
//   open-ended        -> H5P.Essay
//   calculation       -> not exported (H5P has no parameterized formula type)
//
// This is a content-only package: it references the content-type libraries by
// version but does not bundle their JS/CSS, so the target hub must already
// have them installed. On a "missing library" import error, compare these
// versions against the hub's admin library list — that list is the ground
// truth. (Note: Essay is declared at 1.5 because that's the sub-content
// version Question Set's own semantics reference.)
const H5P_LIBRARIES = {
  questionSet: { machineName: 'H5P.QuestionSet', majorVersion: 1, minorVersion: 21 },
  multiChoice: { machineName: 'H5P.MultiChoice', majorVersion: 1, minorVersion: 16 },
  blanks: { machineName: 'H5P.Blanks', majorVersion: 1, minorVersion: 14 },
  essay: { machineName: 'H5P.Essay', majorVersion: 1, minorVersion: 5 },
  image: { machineName: 'H5P.Image', majorVersion: 1, minorVersion: 1 },
};

function libraryString(lib) {
  return `${lib.machineName} ${lib.majorVersion}.${lib.minorVersion}`;
}

// H5P text fields hold HTML; escape stored plain text so markup characters in
// question content can't inject tags.
function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function asHtmlParagraph(text) {
  return `<p>${escapeHtml(String(text || '').trim())}</p>`;
}

function isType(q, type) {
  return normalizeQuestionType(q) === type;
}

// Question types H5P can represent; calculation is excluded (no formula type).
function filterH5PExportableQuestions(questions) {
  return questions.filter((q) => !isType(q, QUESTION_TYPES.CALCULATION));
}

// Sub-content wrapper shared by every embedded library instance.
function subContent(lib, params, title, contentType) {
  return {
    library: libraryString(lib),
    params,
    subContentId: crypto.randomUUID(),
    metadata: {
      contentType,
      license: 'U',
      title: String(title || 'Question').slice(0, 80) || 'Question',
    },
  };
}

// A question's media block: the first bundled stem image, shown above the
// task as an embedded H5P.Image. H5P question types hold a single media item,
// so any additional attached images are not exported. `imageMap` maps a
// bundled fileId to { src, mimeType } (src is relative to content/).
function buildQuestionMedia(q, imageMap) {
  const ref = stemImagesOf(q).find(
    (r) => r && r.fileId && imageMap.get(String(r.fileId))
  );
  if (!ref) return null;

  const entry = imageMap.get(String(ref.fileId));
  const alt = String(ref.caption || ref.alt || '').trim();
  return {
    type: {
      library: libraryString(H5P_LIBRARIES.image),
      params: {
        contentName: 'Image',
        file: {
          path: entry.src,
          mimeType: entry.mimeType || String(ref.mimeType || ''),
        },
        alt,
        // Images without a caption still convey question content, so they are
        // never marked decorative; screen readers at least announce the file.
        decorative: false,
      },
      subContentId: crypto.randomUUID(),
      metadata: {
        contentType: 'Image',
        license: 'U',
        title: (alt || 'Question image').slice(0, 80),
      },
    },
    disableImageZooming: false,
  };
}

// The whole package: { manifest, content } for h5p.json and content/content.json.
function buildH5PPackage(quizName, questions, imageMap = new Map()) {
  const title = String(quizName || 'Quiz').trim() || 'Quiz';
  const exportable = filterH5PExportableQuestions(questions);
  const hasEssay = exportable.some((q) => isType(q, QUESTION_TYPES.OPEN_ENDED));
  const hasImage = exportable.some((q) => buildQuestionMedia(q, imageMap) !== null);

  // Essay and Image are only declared as dependencies when actually used, so
  // quizzes without them import even on hubs lacking those libraries.
  const dependencies = [
    H5P_LIBRARIES.questionSet,
    H5P_LIBRARIES.multiChoice,
    H5P_LIBRARIES.blanks,
    ...(hasEssay ? [H5P_LIBRARIES.essay] : []),
    ...(hasImage ? [H5P_LIBRARIES.image] : []),
  ];

  return {
    manifest: {
      title,
      language: 'en',
      defaultLanguage: 'en',
      mainLibrary: H5P_LIBRARIES.questionSet.machineName,
      embedTypes: ['div'],
      license: 'U',
      preloadedDependencies: dependencies.map(({ machineName, majorVersion, minorVersion }) => ({
        machineName,
        majorVersion,
        minorVersion,
      })),
    },
    content: buildQuestionSetContent(title, exportable, imageMap),
  };
}

// H5P.QuestionSet holding every exportable question.
function buildQuestionSetContent(title, questions, imageMap) {
  return {
    introPage: {
      showIntroPage: true,
      title,
      introduction: `<p>${escapeHtml(title)} — ${questions.length} question${questions.length === 1 ? '' : 's'}.</p>`,
      startButtonText: 'Start Quiz',
    },
    progressType: 'dots',
    passPercentage: 50,
    disableBackwardsNavigation: false,
    randomQuestions: false,
    questions: questions.map((q) => {
      const media = buildQuestionMedia(q, imageMap);
      const withMedia = (params) => (media ? { ...params, media } : params);
      if (isType(q, QUESTION_TYPES.FILL_IN_THE_BLANK)) {
        return subContent(H5P_LIBRARIES.blanks, withMedia(buildBlanksParams(q)), getQuestionText(q), 'Fill in the Blanks');
      }
      if (isType(q, QUESTION_TYPES.OPEN_ENDED)) {
        return subContent(H5P_LIBRARIES.essay, withMedia(buildEssayParams(q)), getQuestionText(q), 'Essay');
      }
      return subContent(H5P_LIBRARIES.multiChoice, withMedia(buildMultiChoiceParams(q)), getQuestionText(q), 'Multiple Choice');
    }),
    endGame: {
      showResultPage: true,
      showSolutionButton: true,
      showRetryButton: true,
    },
  };
}

function buildMultiChoiceParams(q) {
  const correctIndex = getCorrectAnswerIndex(q);
  const answers = ['A', 'B', 'C', 'D'].map((key, i) => {
    const feedback = getOptionFeedback(q, key);
    return {
      text: `<div>${escapeHtml(getOptionText(q, key) || `Option ${key}`)}</div>`,
      correct: i === correctIndex,
      tipsAndFeedback: {
        tip: '',
        chosenFeedback: escapeHtml(feedback),
        notChosenFeedback: '',
      },
    };
  });

  return {
    question: asHtmlParagraph(getQuestionText(q)),
    answers,
    behaviour: {
      enableRetry: true,
      enableSolutionsButton: true,
      // Exactly one correct option in GRASP MC questions.
      type: 'single',
      singlePoint: true,
      randomAnswers: true,
    },
  };
}

// H5P.Blanks marks a blank inline as *answer/alternative*. '*' delimits the
// blank, '/' separates alternatives, ':' starts a tip — so those characters
// are stripped from answers (no escape syntax exists in the format).
function sanitizeBlankAnswer(answer) {
  return String(answer).replace(/[*/:]/g, ' ').replace(/\s+/g, ' ').trim();
}

function buildBlanksParams(q) {
  const answers = getAcceptableAnswers(q)
    .map(sanitizeBlankAnswer)
    .filter(Boolean);
  const blankMarkup = `*${(answers.length ? answers : ['answer']).join('/')}*`;

  // GRASP stems write the blank as a run of underscores; each underscore run
  // becomes the H5P blank markup. If a stem somehow has none, the blank is
  // appended so the question is still answerable.
  const stem = getQuestionText(q);
  const hasBlank = /_{3,}/.test(stem);
  const sentence = hasBlank
    ? stem.split(/_{3,}/).map(escapeHtml).join(blankMarkup)
    : `${escapeHtml(stem)} ${blankMarkup}`;

  return {
    text: '<p>Fill in the missing word.</p>',
    questions: [`<p>${sentence}</p>`],
    behaviour: {
      caseSensitive: false,
      enableRetry: true,
      enableSolutionsButton: true,
      autoCheck: false,
      acceptSpellingErrors: false,
    },
  };
}

// Open-ended -> H5P.Essay. The sample answer becomes the model solution
// (revealed only after the student answers) with the grading criteria as its
// introduction. No auto-scoring keywords are generated — instructors can add
// them in the H5P editor after import.
function buildEssayParams(q) {
  const criteria = String(q.openEndedGradingCriteria || '').trim();
  return {
    taskDescription: asHtmlParagraph(getQuestionText(q)),
    placeholderText: 'Type your answer here…',
    solution: {
      introduction: criteria
        ? `<p>${escapeHtml(`Grading criteria: ${criteria}`)}</p>`
        : '',
      sample: asHtmlParagraph(q.openEndedSampleAnswer || ''),
    },
    keywords: [],
    behaviour: {
      minimumLength: 10,
      enableRetry: true,
    },
  };
}

module.exports = {
  H5P_LIBRARIES,
  filterH5PExportableQuestions,
  buildH5PPackage,
};
