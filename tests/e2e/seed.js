// Shared seed data for the authenticated journey specs.
//
// The instructor journey (bio_prof2) creates its own course through the real UI
// and asserts on it. The STUDENT journey needs a course that already has
// approved questions and a published, currently-open quiz — building that
// through the UI every time would be slow and would couple the student spec to
// the instructor spec. So saml.setup.js calls seedStudentJourneyCourse() once,
// writing directly to MongoDB (same collections the app uses), and the student
// spec reuses it. Everything is upserted against fixed keys, so re-running the
// suite is idempotent and never piles up duplicate courses/quizzes.
//
// The bio_* user records themselves are created by the real SAML logins in
// saml.setup.js (passport upserts grasp_user on first login); this seed only
// wires course/section/quiz data around those users, looked up by the PUIDs the
// local IdP and the FakeAcademicAPI seed share.

const { MongoClient, ObjectId } = require('mongodb');

// PUIDs from docker-simple-saml authsources.php (== FakeAcademicAPI seed).
const BIO_PROF2_PUID = '45678901';
const BIO_STUDENT_PUID = '34567890';
const BIO_STUDENT3_PUID = '67890123';

// Fixed identifiers so the seed is idempotent across runs.
const COURSE_CODE = 'E2E-BIOC-302';
const COURSE_NAME = 'General Biochemistry (BIOC 302, seeded)';
const SECTION_ID = 'SEC-BIOC302-101';
const QUIZ_NAME = 'BIOC 302 Practice Quiz (seeded)';
const OBJECTIVE_NAME = 'Enzyme kinetics (seeded)';
const GRANULAR_NAME = 'Interpret Michaelis–Menten parameters (seeded)';

// Three approved multiple-choice questions, deterministic so the student spec
// can answer a known-correct option. Keyed by `seedKey` for idempotent upserts.
const SEED_QUESTIONS = [
  {
    seedKey: 'e2e-bioc302-q1',
    title: 'What does the Michaelis constant (Km) represent?',
    options: {
      A: { text: 'The substrate concentration at half of Vmax', feedback: '' },
      B: { text: 'The maximum reaction velocity', feedback: 'That is Vmax, not Km.' },
      C: { text: 'The total enzyme concentration', feedback: 'Km is a concentration of substrate, not enzyme.' },
      D: { text: 'The turnover number of the enzyme', feedback: 'That is kcat, not Km.' },
    },
    correctAnswer: 'A',
    bloom: 'Understand',
  },
  {
    seedKey: 'e2e-bioc302-q2',
    title: 'A competitive inhibitor changes which kinetic parameter?',
    options: {
      A: { text: 'It increases the apparent Km', feedback: '' },
      B: { text: 'It decreases Vmax', feedback: 'Competitive inhibition leaves Vmax unchanged.' },
      C: { text: 'It changes the enzyme’s primary sequence', feedback: 'Inhibitors do not alter the sequence.' },
      D: { text: 'It has no effect on kinetics', feedback: 'Competitive inhibitors do affect apparent Km.' },
    },
    correctAnswer: 'A',
    bloom: 'Apply',
  },
  {
    seedKey: 'e2e-bioc302-q3',
    title: 'At substrate concentrations far above Km, reaction rate is:',
    options: {
      A: { text: 'Approximately equal to Vmax', feedback: '' },
      B: { text: 'Proportional to substrate concentration', feedback: 'That holds only well below Km.' },
      C: { text: 'Zero', feedback: 'Rate is near its maximum here, not zero.' },
      D: { text: 'Equal to Km', feedback: 'Km is a concentration, not a rate.' },
    },
    correctAnswer: 'A',
    bloom: 'Understand',
  },
];

// --- AI-graded quiz (issue #45) --------------------------------------------
// A second quiz in the SAME seeded BIOC 302 course, holding the LLM-graded
// question types: one open-ended (judge → pass/fail + per-criterion feedback)
// and one fill-in-the-blank (exact match, plus an LLM rescue fallback for
// equivalent answers). It is a distinct quiz so the existing MCQ-only journey
// specs, which target QUIZ_NAME, are unaffected.
//
// The E2E LLM stub (tests/e2e/stubs/llm-stubs.js) grades deterministically from
// markers the spec types into the answer box: an open-ended answer containing
// "[[e2e-pass]]" passes; a fill-in-the-blank answer containing
// "[[e2e-equivalent]]" is rescued to correct. Anything else fails.
const AI_QUIZ_NAME = 'BIOC 302 AI-Graded Quiz (seeded)';
const AI_OPEN_ENDED_TITLE =
  'Explain how a competitive inhibitor affects apparent Km and Vmax.';
const AI_FIB_TITLE =
  'The substrate concentration at half of Vmax is called the _________.';
const AI_SEED_QUESTIONS = [
  {
    seedKey: 'e2e-bioc302-oe1',
    questionType: 'open-ended',
    title: AI_OPEN_ENDED_TITLE,
    openEndedSampleAnswer:
      'A competitive inhibitor raises the apparent Km because more substrate is needed to reach half of Vmax, while Vmax is unchanged since excess substrate outcompetes the inhibitor.',
    openEndedGradingCriteria:
      'States that apparent Km increases; states that Vmax is unchanged; explains why in terms of competition for the active site.',
    bloom: 'Understand',
  },
  {
    seedKey: 'e2e-bioc302-fib1',
    questionType: 'fill-in-the-blank',
    title: AI_FIB_TITLE,
    correctAnswer: 'Michaelis constant',
    acceptableAnswers: ['Michaelis constant', 'Km'],
    bloom: 'Remember',
  },
];

async function getUserByPuid(db, puid) {
  return db.collection('grasp_user').findOne({ puid });
}

/**
 * Seed the shared BIOC 302 course for the student journey. Idempotent: safe to
 * call on every suite run. Returns a small summary the specs can log.
 *
 * Prereq: bio_prof2 / bio_student / bio_student3 have logged in at least once
 * (saml.setup.js does this) so their grasp_user rows exist.
 */
async function seedStudentJourneyCourse() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is required to seed the student journey course');

  const client = new MongoClient(uri, {
    connectTimeoutMS: 8000,
    serverSelectionTimeoutMS: 8000,
  });
  await client.connect();

  try {
    const db = client.db(process.env.MONGODB_DB_NAME || 'grasp_db');
    const now = new Date();

    const prof = await getUserByPuid(db, BIO_PROF2_PUID);
    const student = await getUserByPuid(db, BIO_STUDENT_PUID);
    const student3 = await getUserByPuid(db, BIO_STUDENT3_PUID);
    if (!prof || !student || !student3) {
      throw new Error(
        'Seed prerequisite missing: bio_prof2 / bio_student / bio_student3 must log in before seeding ' +
          `(prof=${!!prof}, student=${!!student}, student3=${!!student3})`
      );
    }

    // --- Course owned by bio_prof2 ---
    await db.collection('grasp_course').updateOne(
      { courseCode: COURSE_CODE },
      {
        $set: { courseName: COURSE_NAME, campus: 'ACADEMIC_UNIT-UBC-V', owner: prof._id, ubcCourseId: 'BIOC|302', updatedAt: now },
        $setOnInsert: { courseCode: COURSE_CODE, courseAccess: 'e2ebioc302seed', createdAt: now },
      },
      { upsert: true }
    );
    const course = await db.collection('grasp_course').findOne({ courseCode: COURSE_CODE });
    const courseId = course._id;

    // --- Membership: instructor + two students ---
    for (const user of [prof, student, student3]) {
      await db.collection('grasp_user_course').updateOne(
        { userId: user._id, courseId },
        { $setOnInsert: { userId: user._id, courseId, createdAt: now } },
        { upsert: true }
      );
    }

    // --- Section (owned by the instructor) + student section membership ---
    await db.collection('grasp_course_section').updateOne(
      { courseId, sectionId: SECTION_ID },
      {
        $set: { sectionNumber: '101', academicPeriod: 'AP-SEED-W1', academicPeriodName: 'Seeded Winter Term 1', owner: prof._id, updatedAt: now },
        $setOnInsert: { courseId, sectionId: SECTION_ID, createdAt: now },
      },
      { upsert: true }
    );
    const section = await db.collection('grasp_course_section').findOne({ courseId, sectionId: SECTION_ID });

    for (const user of [student, student3]) {
      await db.collection('grasp_user_course_section').updateOne(
        { userId: user._id, courseId, sectionId: SECTION_ID },
        { $setOnInsert: { userId: user._id, courseId, sectionId: SECTION_ID } },
        { upsert: true }
      );
    }

    // --- Learning objective (parent) + one granular child ---
    await db.collection('grasp_objective').updateOne(
      { courseId, name: OBJECTIVE_NAME, parent: 0 },
      { $setOnInsert: { courseId, name: OBJECTIVE_NAME, parent: 0, createdAt: now } },
      { upsert: true }
    );
    const parentObjective = await db
      .collection('grasp_objective')
      .findOne({ courseId, name: OBJECTIVE_NAME, parent: 0 });

    await db.collection('grasp_objective').updateOne(
      { courseId, name: GRANULAR_NAME, parent: parentObjective._id },
      {
        $setOnInsert: {
          courseId,
          name: GRANULAR_NAME,
          parent: parentObjective._id,
          bloomTaxonomies: ['Understand', 'Apply'],
          createdAt: now,
        },
      },
      { upsert: true }
    );
    const granular = await db
      .collection('grasp_objective')
      .findOne({ courseId, name: GRANULAR_NAME, parent: parentObjective._id });

    // --- Approved questions ---
    const questionIds = [];
    for (const q of SEED_QUESTIONS) {
      await db.collection('grasp_question').updateOne(
        { courseId, seedKey: q.seedKey },
        {
          $set: {
            title: q.title,
            stem: q.title,
            options: q.options,
            correctAnswer: q.correctAnswer,
            questionType: 'multiple-choice',
            bloom: q.bloom,
            granularObjectiveId: granular._id,
            status: 'Approved',
            flagStatus: false,
            createdBy: 'e2e-seed',
            updatedAt: now,
          },
          $setOnInsert: { courseId, seedKey: q.seedKey, createdAt: now },
        },
        { upsert: true }
      );
      const saved = await db.collection('grasp_question').findOne({ courseId, seedKey: q.seedKey });
      questionIds.push(saved._id);
    }

    // --- Published quiz (all-approved delivery) ---
    await db.collection('grasp_quiz').updateOne(
      { courseId, name: QUIZ_NAME },
      {
        $set: {
          published: true,
          deliveryFormat: 'all-approved',
          disablePreviousNavigation: false,
          description: 'Seeded quiz for the student E2E journey.',
          updatedAt: now,
        },
        $setOnInsert: { courseId, name: QUIZ_NAME, createdAt: now },
      },
      { upsert: true }
    );
    const quiz = await db.collection('grasp_quiz').findOne({ courseId, name: QUIZ_NAME });

    // Quiz ↔ question mappings (idempotent per pair).
    for (const questionId of questionIds) {
      await db.collection('grasp_quiz_question').updateOne(
        { quizId: quiz._id, questionId },
        { $setOnInsert: { quizId: quiz._id, questionId, createdAt: now } },
        { upsert: true }
      );
    }

    // --- Reset attempt state from previous runs. Completion is persisted per
    // user+quiz (grasp_quiz_score & co.), and the student UI offers "Retake
    // Quiz" instead of "Start Quiz" for a completed quiz — without this reset
    // the student spec's first "Start Quiz" step only passes on a fresh DB.
    for (const coll of [
      'grasp_student_attempt',
      'grasp_student_performance',
      'grasp_quiz_score',
      'grasp_achievement',
    ]) {
      await db.collection(coll).deleteMany({ quizId: quiz._id });
    }

    // --- Per-section schedule: open now, expires well in the future so the
    // quiz is visible to the section's students today. ---
    const releaseDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const expireDate = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
    await db.collection('grasp_quiz_section_schedule').updateOne(
      { quizId: quiz._id, courseSectionId: section._id },
      {
        $set: { releaseDate, expireDate, updatedAt: now },
        $setOnInsert: { quizId: quiz._id, courseSectionId: section._id, createdAt: now },
      },
      { upsert: true }
    );

    // --- AI-graded quiz (issue #45): open-ended + fill-in-the-blank questions
    // in the same course, on the same section schedule. ---
    const aiQuestionIds = [];
    for (const q of AI_SEED_QUESTIONS) {
      const base = {
        title: q.title,
        stem: q.title,
        question: q.title,
        questionType: q.questionType,
        bloom: q.bloom,
        granularObjectiveId: granular._id,
        status: 'Approved',
        flagStatus: false,
        createdBy: 'e2e-seed',
        updatedAt: now,
      };
      if (q.questionType === 'open-ended') {
        base.openEndedSampleAnswer = q.openEndedSampleAnswer;
        base.openEndedGradingCriteria = q.openEndedGradingCriteria;
        base.options = null;
      } else {
        base.correctAnswer = q.correctAnswer;
        base.acceptableAnswers = q.acceptableAnswers;
        base.options = null;
      }
      await db.collection('grasp_question').updateOne(
        { courseId, seedKey: q.seedKey },
        { $set: base, $setOnInsert: { courseId, seedKey: q.seedKey, createdAt: now } },
        { upsert: true }
      );
      const saved = await db.collection('grasp_question').findOne({ courseId, seedKey: q.seedKey });
      aiQuestionIds.push(saved._id);
    }

    await db.collection('grasp_quiz').updateOne(
      { courseId, name: AI_QUIZ_NAME },
      {
        $set: {
          published: true,
          deliveryFormat: 'all-approved',
          disablePreviousNavigation: false,
          description: 'Seeded AI-graded quiz for the LLM grading E2E flow (issue #45).',
          updatedAt: now,
        },
        $setOnInsert: { courseId, name: AI_QUIZ_NAME, createdAt: now },
      },
      { upsert: true }
    );
    const aiQuiz = await db.collection('grasp_quiz').findOne({ courseId, name: AI_QUIZ_NAME });

    for (const questionId of aiQuestionIds) {
      await db.collection('grasp_quiz_question').updateOne(
        { quizId: aiQuiz._id, questionId },
        { $setOnInsert: { quizId: aiQuiz._id, questionId, createdAt: now } },
        { upsert: true }
      );
    }

    for (const coll of [
      'grasp_student_attempt',
      'grasp_student_performance',
      'grasp_quiz_score',
      'grasp_achievement',
    ]) {
      await db.collection(coll).deleteMany({ quizId: aiQuiz._id });
    }

    await db.collection('grasp_quiz_section_schedule').updateOne(
      { quizId: aiQuiz._id, courseSectionId: section._id },
      {
        $set: { releaseDate, expireDate, updatedAt: now },
        $setOnInsert: { quizId: aiQuiz._id, courseSectionId: section._id, createdAt: now },
      },
      { upsert: true }
    );

    return {
      courseId: courseId.toString(),
      courseName: course.courseName,
      quizId: quiz._id.toString(),
      quizName: QUIZ_NAME,
      questionCount: questionIds.length,
      aiQuizId: aiQuiz._id.toString(),
      aiQuizName: AI_QUIZ_NAME,
    };
  } finally {
    await client.close();
  }
}

/**
 * Delete bio_student's recorded answers and saved score for the seeded quiz.
 *
 * The first-attempt resume flow (issue #36) only restores answers while no
 * score row exists, and /check's first-answer-wins rule skips re-recording
 * answered questions — so any earlier spec (dashboard, quiz summary) or prior
 * run that completed the seeded quiz would make a resume test start from a
 * "already submitted" state. Calling this first makes the test deterministic
 * regardless of spec order.
 */
async function resetSeededQuizAttemptState() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is required to reset seeded quiz attempt state');

  const client = new MongoClient(uri, {
    connectTimeoutMS: 8000,
    serverSelectionTimeoutMS: 8000,
  });
  await client.connect();

  try {
    const db = client.db(process.env.MONGODB_DB_NAME || 'grasp_db');
    const student = await getUserByPuid(db, BIO_STUDENT_PUID);
    const course = await db.collection('grasp_course').findOne({ courseCode: COURSE_CODE });
    const quiz = course
      ? await db.collection('grasp_quiz').findOne({ courseId: course._id, name: QUIZ_NAME })
      : null;
    if (!student || !quiz) {
      throw new Error(
        'resetSeededQuizAttemptState: seeded user/quiz missing — saml.setup.js must run first'
      );
    }

    const filter = { userId: student._id, quizId: quiz._id };
    await db.collection('grasp_student_attempt').deleteMany(filter);
    await db.collection('grasp_quiz_score').deleteMany(filter);
  } finally {
    await client.close();
  }
}

/**
 * Delete the given student's recorded answers, score, and mastery for the
 * seeded AI-graded quiz (issue #45). The AI-grading specs take that quiz and
 * then have the instructor grade/override open-ended answers, so each run must
 * start from a clean, un-taken state regardless of spec order or prior runs.
 *
 * @param {string} puid - PUID of the student to reset (defaults to bio_student).
 */
async function resetSeededAiQuizAttemptState(puid = BIO_STUDENT_PUID) {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is required to reset seeded AI quiz attempt state');

  const client = new MongoClient(uri, {
    connectTimeoutMS: 8000,
    serverSelectionTimeoutMS: 8000,
  });
  await client.connect();

  try {
    const db = client.db(process.env.MONGODB_DB_NAME || 'grasp_db');
    const student = await getUserByPuid(db, puid);
    const course = await db.collection('grasp_course').findOne({ courseCode: COURSE_CODE });
    const quiz = course
      ? await db.collection('grasp_quiz').findOne({ courseId: course._id, name: AI_QUIZ_NAME })
      : null;
    if (!student || !quiz) {
      throw new Error(
        'resetSeededAiQuizAttemptState: seeded user/quiz missing — saml.setup.js must run first'
      );
    }

    const filter = { userId: student._id, quizId: quiz._id };
    await db.collection('grasp_student_attempt').deleteMany(filter);
    await db.collection('grasp_student_performance').deleteMany(filter);
    await db.collection('grasp_quiz_score').deleteMany(filter);
    await db.collection('grasp_achievement').deleteMany(filter);
  } finally {
    await client.close();
  }
}

module.exports = {
  seedStudentJourneyCourse,
  resetSeededQuizAttemptState,
  resetSeededAiQuizAttemptState,
  SEED: {
    COURSE_CODE,
    COURSE_NAME,
    SECTION_ID,
    QUIZ_NAME,
    OBJECTIVE_NAME,
    GRANULAR_NAME,
    BIO_PROF2_PUID,
    BIO_STUDENT_PUID,
    BIO_STUDENT3_PUID,
    QUESTION_COUNT: SEED_QUESTIONS.length,
    // Seeded question titles in insertion order, for question-bank assertions.
    QUESTION_TITLES: SEED_QUESTIONS.map((q) => q.title),
    // The correct option letter for every seeded question is "A" — the student
    // spec relies on this to answer correctly without reading answer keys.
    CORRECT_OPTION_LETTER: 'A',
    // Correct option text per seeded question (option A of each), in quiz order.
    CORRECT_OPTION_TEXTS: SEED_QUESTIONS.map((q) => q.options.A.text),
    // AI-graded quiz (issue #45): distinct quiz in the same course.
    AI_QUIZ_NAME,
    AI_OPEN_ENDED_TITLE,
    AI_FIB_TITLE,
    // Markers the E2E LLM stub keys on for a deterministic passing verdict.
    AI_PASS_MARKER: '[[e2e-pass]]',
    AI_EQUIVALENT_MARKER: '[[e2e-equivalent]]',
  },
};
