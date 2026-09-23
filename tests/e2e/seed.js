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
const { FAKE_CANVAS } = require('./stubs/fake-canvas-fixtures');

// PUIDs from docker-simple-saml authsources.php (== FakeAcademicAPI seed).
const BIO_PROF2_PUID = '45678901';
const BIO_STUDENT_PUID = '34567890';
const BIO_STUDENT3_PUID = '67890123';
// The plain `student` persona: logged in by saml.setup.js so its grasp_user
// row exists, but never seeded into any course. The add-people spec (issue
// #115) uses it as the guest an instructor lets in by hand.
const STUDENT_PUID = '87654321';

// Fixed identifiers so the seed is idempotent across runs.
const COURSE_CODE = 'E2E-BIOC-302';
const COURSE_NAME = 'General Biochemistry (BIOC 302, seeded)';
const SECTION_ID = 'SEC-BIOC302-101';
const QUIZ_NAME = 'BIOC 302 Practice Quiz (seeded)';
const OBJECTIVE_NAME = 'Enzyme kinetics (seeded)';
const GRANULAR_NAME = 'Interpret Michaelis–Menten parameters (seeded)';

// A material linked to the parent objective. The Question Bank add-question
// wizard only enables AI generation for an objective that has linked materials
// (it retrieves context from them), so the AI-branch E2E spec needs this.
const MATERIAL_TITLE = 'Enzyme kinetics lecture notes (seeded)';
const MATERIAL_SOURCE_ID = 'e2e-bioc302-material-1';

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

// --- Canvas roster sync (issue #113) ----------------------------------------
// A second bio_prof2 course whose section 101 is linked to the fake Canvas
// section (tests/e2e/stubs/fake-canvas.js). It is a separate course so syncs
// that drop students never touch the shared BIOC 302 course the other specs
// rely on. Section 102 stays unlinked and keeps the Academic API sync.
const CANVAS_COURSE_CODE = 'E2E-CANVAS-SYNC';
const CANVAS_COURSE_NAME = 'Canvas Roster Sync (seeded)';
const CANVAS_LINKED_SECTION_ID = 'SEC-CANVAS-101';
const CANVAS_LINKED_SECTION_NUMBER = '101';
const CANVAS_UNLINKED_SECTION_ID = 'SEC-CANVAS-102';
const CANVAS_UNLINKED_SECTION_NUMBER = '102';
const CANVAS_QUIZ_NAME = 'Canvas Section Quiz (seeded)';
// Far enough ahead that the toolkit never tries to refresh the seeded token.
const CANVAS_TOKEN_EXPIRES_AT = Date.UTC(2099, 0, 1);

async function getUserByPuid(db, puid) {
  return db.collection('grasp_user').findOne({ puid });
}

async function withSeedDb(fn) {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is required to seed e2e data');

  const client = new MongoClient(uri, {
    connectTimeoutMS: 8000,
    serverSelectionTimeoutMS: 8000,
  });
  await client.connect();
  try {
    return await fn(client.db(process.env.MONGODB_DB_NAME || 'grasp_db'));
  } finally {
    await client.close();
  }
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
        // Never LMS-linked: the PR #90 link specs start from "Link Canvas" /
        // "Link Moodle", and a link left by a manual run would hide them.
        $unset: { lmsLink: '' },
        $setOnInsert: { courseId, sectionId: SECTION_ID, createdAt: now },
      },
      { upsert: true }
    );
    const section = await db.collection('grasp_course_section').findOne({ courseId, sectionId: SECTION_ID });

    for (const user of [student, student3]) {
      await db.collection('grasp_user_course_section').updateOne(
        { userId: user._id, courseId, sectionId: SECTION_ID },
        {
          // Active again if a removal or roster sync soft-dropped the row
          // (issue #113); a dropped row grants no quiz access.
          $unset: { droppedAt: '', droppedReason: '', droppedBy: '' },
          $setOnInsert: { userId: user._id, courseId, sectionId: SECTION_ID },
        },
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

    // --- Material linked to the parent objective, enabling AI question
    // generation in the add-question wizard (which needs an objective with
    // materials to retrieve context from). ---
    await db.collection('grasp_material').updateOne(
      { courseId, sourceId: MATERIAL_SOURCE_ID },
      {
        $set: {
          documentTitle: MATERIAL_TITLE,
          fileType: 'text',
          fileSize: 0,
          fileContent:
            'Michaelis–Menten kinetics: Km is the substrate concentration at half of Vmax; ' +
            'Vmax is the maximum reaction velocity; a competitive inhibitor raises apparent Km.',
          updatedAt: now,
        },
        $setOnInsert: { courseId, sourceId: MATERIAL_SOURCE_ID, createdAt: now },
      },
      { upsert: true }
    );
    const material = await db
      .collection('grasp_material')
      .findOne({ courseId, sourceId: MATERIAL_SOURCE_ID });

    await db.collection('grasp_objective_material').updateOne(
      { objectiveId: parentObjective._id, materialId: material._id },
      {
        $setOnInsert: {
          objectiveId: parentObjective._id,
          materialId: material._id,
          createdAt: now,
        },
      },
      { upsert: true }
    );

    // --- Questions the stubbed LLM generated and a spec saved ("Stub
    // question N"). The stub's numbering restarts with every server boot, so
    // one left from an earlier run makes the next AI-generation spec produce
    // a duplicate that generation rejects. ---
    const stubQuestions = await db
      .collection('grasp_question')
      .find({ courseId, title: /^Stub question \d+$/ }, { projection: { _id: 1 } })
      .toArray();
    if (stubQuestions.length > 0) {
      const stubIds = stubQuestions.map((question) => question._id);
      await db.collection('grasp_quiz_question').deleteMany({ questionId: { $in: stubIds } });
      await db.collection('grasp_question').deleteMany({ _id: { $in: stubIds } });
    }

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
    // Keep the shared fixture canonical after a spec adds a question to the
    // quiz. Without this, a later run could treat a previously added question
    // as part of the seed and make the picker tests order-dependent.
    await db.collection('grasp_quiz_question').deleteMany({
      quizId: quiz._id,
      questionId: { $nin: questionIds },
    });

    // --- Reset attempt state from previous runs. Completion is persisted per
    // user+quiz (grasp_quiz_score & co.), and the student UI offers "Retake
    // Quiz" instead of "Start Quiz" for a completed quiz — without this reset
    // the student spec's first "Start Quiz" step only passes on a fresh DB.
    // grasp_quiz_session holds the immutable first-start deadline: one left
    // from a run more than the time limit ago makes every later start open
    // an already-expired attempt.
    for (const coll of [
      'grasp_student_attempt',
      'grasp_student_performance',
      'grasp_quiz_score',
      'grasp_achievement',
      'grasp_quiz_session',
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
      'grasp_quiz_session',
    ]) {
      await db.collection(coll).deleteMany({ quizId: aiQuiz._id });
    }
    // Achievements of a seeded quiz that has since been deleted and re-seeded
    // under a new id keep its name, so the achievements page would show two
    // cards for "the" seeded quiz.
    await db.collection('grasp_achievement').deleteMany({
      courseId,
      quizId: { $nin: [quiz._id, aiQuiz._id] },
      quizName: { $in: [QUIZ_NAME, AI_QUIZ_NAME] },
    });

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
    // The timed session too, or the "fresh" attempt inherits an old deadline.
    await db.collection('grasp_quiz_session').deleteMany(filter);
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
/**
 * The guest persona's current grasp_user record. Its email and names come
 * from whatever the local IdP and academic-API fake last wrote (a login
 * refreshes them), so specs must read them rather than hardcode them.
 */
async function getGuestPersonaUser() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is required to look up the guest persona');

  const client = new MongoClient(uri, {
    connectTimeoutMS: 8000,
    serverSelectionTimeoutMS: 8000,
  });
  await client.connect();
  try {
    const db = client.db(process.env.MONGODB_DB_NAME || 'grasp_db');
    const user = await getUserByPuid(db, STUDENT_PUID);
    if (!user) {
      throw new Error(
        'getGuestPersonaUser: the `student` persona has not logged in — saml.setup.js must run first'
      );
    }
    return {
      _id: String(user._id),
      email: user.email,
      displayName: user.displayName,
      legalName: user.legalName,
    };
  } finally {
    await client.close();
  }
}

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
    await db.collection('grasp_quiz_session').deleteMany(filter);
  } finally {
    await client.close();
  }
}

/**
 * Seed (or reset) the Canvas roster sync course. Idempotent, and a full reset:
 * every call puts the course back to "linked, never synced", so a Canvas spec
 * can call it in beforeAll regardless of what an earlier run or suite did.
 *
 *   - section 101 is linked to FAKE_CANVAS.SECTION_ID with a fresh lmsLink (no
 *     lastSync / dropsReviewedAt), so the next sync is a first sync;
 *   - bio_student and bio_student3 are active in section 101, as if an earlier
 *     Academic API sync had added them. bio_student joined with the invite
 *     code, so a drop keeps their course membership and only the section row
 *     (and with it the section's quiz) goes;
 *   - a published quiz is open to section 101 only;
 *   - bio_prof2 gets a far-future token row in grasp_lms_canvas_tokens, the
 *     shape the toolkit's Mongo token store reads. This replaces any real
 *     Canvas token bio_prof2 had in this database.
 *
 * Placeholder users a sync created for fake-Canvas-only PUIDs are deleted.
 * Prereq: the bio_* personas have logged in (saml.setup.js).
 */
async function seedCanvasSyncCourse() {
  return withSeedDb(async (db) => {
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

    await db.collection('grasp_course').updateOne(
      { courseCode: CANVAS_COURSE_CODE },
      {
        $set: {
          courseName: CANVAS_COURSE_NAME,
          campus: 'ACADEMIC_UNIT-UBC-V',
          owner: prof._id,
          ubcCourseId: 'BIOC|302',
          archived: false,
          updatedAt: now,
        },
        $unset: { archivedAt: '', archivedBy: '', nickname: '' },
        $setOnInsert: { courseCode: CANVAS_COURSE_CODE, courseAccess: 'e2ecanvassyncseed', createdAt: now },
      },
      { upsert: true }
    );
    const course = await db.collection('grasp_course').findOne({ courseCode: CANVAS_COURSE_CODE });
    const courseId = course._id;

    // --- Sections: 101 freshly linked to the fake Canvas, 102 unlinked ---
    const sectionBase = {
      academicPeriod: 'AP-SEED-W1',
      academicPeriodName: 'Seeded Winter Term 1',
      owner: prof._id,
      updatedAt: now,
    };
    await db.collection('grasp_course_section').updateOne(
      { courseId, sectionId: CANVAS_LINKED_SECTION_ID },
      {
        $set: {
          ...sectionBase,
          sectionNumber: CANVAS_LINKED_SECTION_NUMBER,
          // The whole object, as linking writes it: no lastSync and no
          // dropsReviewedAt, so the next sync is a first sync.
          lmsLink: {
            provider: 'canvas',
            instance: FAKE_CANVAS.ORIGIN,
            externalCourseId: FAKE_CANVAS.COURSE_ID,
            externalCourseName: FAKE_CANVAS.COURSE_NAME,
            externalCourseCode: FAKE_CANVAS.COURSE_CODE,
            externalSectionId: FAKE_CANVAS.SECTION_ID,
            externalSectionName: FAKE_CANVAS.SECTION_NAME,
            linkedBy: prof._id,
            linkedAt: now,
          },
        },
        $setOnInsert: { courseId, sectionId: CANVAS_LINKED_SECTION_ID, createdAt: now },
      },
      { upsert: true }
    );
    await db.collection('grasp_course_section').updateOne(
      { courseId, sectionId: CANVAS_UNLINKED_SECTION_ID },
      {
        $set: { ...sectionBase, sectionNumber: CANVAS_UNLINKED_SECTION_NUMBER },
        $unset: { lmsLink: '' },
        $setOnInsert: { courseId, sectionId: CANVAS_UNLINKED_SECTION_ID, createdAt: now },
      },
      { upsert: true }
    );
    await db.collection('grasp_course_section').deleteMany({
      courseId,
      sectionId: { $nin: [CANVAS_LINKED_SECTION_ID, CANVAS_UNLINKED_SECTION_ID] },
    });
    const linkedSection = await db
      .collection('grasp_course_section')
      .findOne({ courseId, sectionId: CANVAS_LINKED_SECTION_ID });

    // --- Placeholders a previous sync created for fake-Canvas-only PUIDs ---
    const placeholders = await db
      .collection('grasp_user')
      .find({ puid: { $in: [FAKE_CANVAS.NEVER_SIGNED_IN_PUID, FAKE_CANVAS.CONCLUDED_PUID] } })
      .toArray();
    const placeholderIds = placeholders.map((user) => user._id);
    if (placeholderIds.length > 0) {
      await db.collection('grasp_user_course').deleteMany({ userId: { $in: placeholderIds } });
      await db.collection('grasp_user_course_section').deleteMany({ userId: { $in: placeholderIds } });
      await db.collection('grasp_user').deleteMany({ _id: { $in: placeholderIds } });
    }

    // --- Memberships: exactly the owner and the two students ---
    const members = [
      { user: prof, source: 'owner' },
      { user: student, source: 'invite-code' },
      { user: student3, source: 'roster-sync' },
    ];
    await db.collection('grasp_user_course').deleteMany({
      courseId,
      userId: { $nin: members.map(({ user }) => user._id) },
    });
    for (const { user, source } of members) {
      await db.collection('grasp_user_course').updateOne(
        { userId: user._id, courseId },
        {
          $set: { source },
          $unset: { courseRole: '' },
          $setOnInsert: { userId: user._id, courseId, createdAt: now },
        },
        { upsert: true }
      );
    }

    // --- Section rows: both students active in 101, nothing else ---
    await db.collection('grasp_user_course_section').deleteMany({ courseId });
    await db.collection('grasp_user_course_section').insertMany(
      [student, student3].map((user) => ({
        userId: user._id,
        courseId,
        sectionId: CANVAS_LINKED_SECTION_ID,
        source: 'academic-api',
        createdAt: now,
        syncedAt: now,
      }))
    );

    // Sync events from earlier runs would make the access-history assertions
    // ambiguous.
    await db.collection('grasp_course_access_log').deleteMany({ courseId });

    // --- A published quiz open to section 101 only ---
    await db.collection('grasp_quiz').updateOne(
      { courseId, name: CANVAS_QUIZ_NAME },
      {
        $set: {
          published: true,
          deliveryFormat: 'all-approved',
          disablePreviousNavigation: false,
          description: 'Seeded quiz for the Canvas roster sync E2E flow (issue #113).',
          updatedAt: now,
        },
        $setOnInsert: { courseId, name: CANVAS_QUIZ_NAME, createdAt: now },
      },
      { upsert: true }
    );
    const quiz = await db.collection('grasp_quiz').findOne({ courseId, name: CANVAS_QUIZ_NAME });
    await db.collection('grasp_quiz_section_schedule').deleteMany({ quizId: quiz._id });
    await db.collection('grasp_quiz_section_schedule').insertOne({
      quizId: quiz._id,
      courseSectionId: linkedSection._id,
      releaseDate: new Date(now.getTime() - 24 * 60 * 60 * 1000),
      expireDate: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000),
      createdAt: now,
      updatedAt: now,
    });

    // --- bio_prof2's Canvas connection, keyed like the app's getUserKey ---
    await db.collection('grasp_lms_canvas_tokens').updateOne(
      { userKey: String(prof._id) },
      {
        $set: {
          tokens: {
            accessToken: FAKE_CANVAS.TEACHER_TOKEN,
            refreshToken: FAKE_CANVAS.TEACHER_REFRESH_TOKEN,
            expiresAt: CANVAS_TOKEN_EXPIRES_AT,
            canvasUserId: FAKE_CANVAS.TEACHER_USER_ID,
          },
        },
      },
      { upsert: true }
    );

    return {
      courseId: courseId.toString(),
      courseName: CANVAS_COURSE_NAME,
      quizId: quiz._id.toString(),
    };
  });
}

/**
 * A persona's grasp_user fields as instructor views show them. Names come from
 * the IdP and academic-API fake at login, so specs read them rather than
 * hardcode them.
 */
async function getPersonaUser(puid) {
  return withSeedDb(async (db) => {
    const user = await getUserByPuid(db, puid);
    if (!user) {
      throw new Error(`getPersonaUser: no grasp_user with PUID ${puid} — saml.setup.js must run first`);
    }
    return {
      _id: String(user._id),
      email: user.email,
      displayName: user.displayName,
      legalName: user.legalName,
      // The name instructor views (and the sync's drop list) show.
      instructorName: user.legalName || user.displayName || user.email,
    };
  });
}

module.exports = {
  seedStudentJourneyCourse,
  seedCanvasSyncCourse,
  getPersonaUser,
  resetSeededQuizAttemptState,
  resetSeededAiQuizAttemptState,
  getGuestPersonaUser,
  SEED: {
    COURSE_CODE,
    COURSE_NAME,
    SECTION_ID,
    QUIZ_NAME,
    OBJECTIVE_NAME,
    GRANULAR_NAME,
    MATERIAL_TITLE,
    MATERIAL_SOURCE_ID,
    BIO_PROF2_PUID,
    BIO_STUDENT_PUID,
    BIO_STUDENT3_PUID,
    STUDENT_PUID,
    QUESTION_COUNT: SEED_QUESTIONS.length,
    AI_QUESTION_COUNT: AI_SEED_QUESTIONS.length,
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
    // Canvas roster sync course (issue #113), linked to the fake Canvas.
    CANVAS_COURSE_CODE,
    CANVAS_COURSE_NAME,
    CANVAS_LINKED_SECTION_ID,
    CANVAS_LINKED_SECTION_NUMBER,
    CANVAS_UNLINKED_SECTION_ID,
    CANVAS_UNLINKED_SECTION_NUMBER,
    CANVAS_QUIZ_NAME,
  },
};
