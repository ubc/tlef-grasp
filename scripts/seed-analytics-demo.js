#!/usr/bin/env node
//
// Seed a self-contained demo course for trying out the Analytics page.
//
//   npm run seed:analytics-demo                          # create or refresh it
//   npm run seed:analytics-demo -- --owner <email|puid>  # pick the owning faculty
//   npm run seed:analytics-demo -- --reset               # remove it all
//
// Writes to the database in MONGODB_URI / MONGODB_DB_NAME. Everything it
// creates carries seedTag "analytics-demo" — its own course, fake students,
// sections, objectives, questions, quizzes and answers — so it never touches
// a real course, and --reset removes exactly what it added. Re-running first
// removes the previous demo data, then writes it again; the answers come from
// a fixed random seed, so every run produces the same numbers.
//
// The data is shaped to exercise every state of the Questions tab: easy,
// moderate and hard questions; a question whose wrong answers cluster on one
// option; open-ended answers still awaiting grading; a question too few
// students answered to be rated; a question nobody has answered; and a small
// section (102, four students) that is below the response minimum on its own.
// It also writes the adaptive engine's per-objective state, so the
// Objectives tab has remediation flags to count.
//
// Owner: --owner, or else the only faculty user in the database.

require("dotenv").config({ quiet: true });
const { MongoClient } = require("mongodb");

const SEED_TAG = "analytics-demo";
const COURSE_CODE = "DEMO-ANALYTICS";
const COURSE_NAME = "Analytics Demo (seeded)";
const RANDOM_SEED = 20261012;

const SECTIONS = [
  { sectionId: "SEC-DEMO-ANALYTICS-101", sectionNumber: "101", students: 22 },
  { sectionId: "SEC-DEMO-ANALYTICS-102", sectionNumber: "102", students: 4 },
];

const OBJECTIVES = [
  {
    name: "Limits and continuity",
    granular: ["Evaluate limits algebraically", "Classify discontinuities"],
  },
  {
    name: "Differentiation",
    granular: ["Apply the chain rule", "Interpret the derivative as a rate of change"],
  },
];

const mc = (title, options, correct, extra) => ({
  questionType: "multiple-choice",
  title,
  options: Object.fromEntries(
    options.map((text, i) => ["ABCD"[i], { text, feedback: "" }])
  ),
  correctAnswer: correct,
  ...extra,
});

// target: share of students who answer correctly. wrongWeights: how the
// wrong answers spread over the other options. answeredBy: cap on how many
// students answered (0 = a question nobody has reached yet).
const QUIZZES = [
  {
    name: "Quiz 1: Limits (seeded)",
    skippedBy: 2,
    questions: [
      mc("What is lim x→2 of (x² − 4)/(x − 2)?", ["4", "0", "2", "Does not exist"], "A",
        { objective: [0, 0], bloom: "Apply", target: 0.94 }),
      mc("lim x→0 of sin(x)/x equals:", ["0", "1", "∞", "Undefined"], "B",
        { objective: [0, 0], bloom: "Remember", target: 0.78 }),
      mc("f(x) = 1/x has what kind of discontinuity at x = 0?",
        ["Removable", "Jump", "Infinite", "None"], "C",
        { objective: [0, 1], bloom: "Understand", target: 0.55 }),
      mc("A function continuous on [a, b] must:",
        ["Be differentiable on (a, b)", "Attain a maximum and minimum on [a, b]",
          "Be increasing", "Have a root in (a, b)"], "B",
        { objective: [0, 1], bloom: "Understand", target: 0.4, wrongWeights: { A: 6, C: 1, D: 2 } }),
      mc("lim x→∞ of (3x² + x)/(5 − 2x²) equals:", ["3/5", "−3/2", "0", "∞"], "B",
        { objective: [0, 0], bloom: "Analyze", target: 0.16, wrongWeights: { A: 8, C: 1, D: 2 } }),
      {
        questionType: "fill-in-the-blank",
        title: "A discontinuity that can be removed by redefining one point is called _________.",
        correctAnswer: "removable",
        acceptableAnswers: ["removable", "a removable discontinuity"],
        objective: [0, 1], bloom: "Remember", target: 0.62,
      },
    ],
  },
  {
    name: "Quiz 2: Derivatives (seeded)",
    skippedBy: 3,
    questions: [
      mc("d/dx of sin(3x) is:", ["cos(3x)", "3cos(3x)", "−3cos(3x)", "3sin(3x)"], "B",
        { objective: [1, 0], bloom: "Apply", target: 0.86 }),
      mc("d/dx of e^(x²) is:", ["e^(x²)", "2x·e^(x²)", "x²·e^(x²−1)", "2e^x"], "B",
        { objective: [1, 0], bloom: "Apply", target: 0.24, wrongWeights: { A: 7, C: 3, D: 1 } }),
      {
        questionType: "open-ended",
        title: "Explain what f′(3) = −2 tells you about f near x = 3.",
        openEndedSampleAnswer: "f is decreasing at x = 3, falling about 2 units per unit increase in x.",
        openEndedGradingCriteria: "Says f is decreasing; interprets −2 as the instantaneous rate of change.",
        objective: [1, 1], bloom: "Understand", target: 0.7, pendingShare: 0.4,
      },
      mc("If s(t) is position, s′(t) represents:", ["Acceleration", "Velocity", "Distance", "Jerk"], "B",
        { objective: [1, 1], bloom: "Understand", target: 0.5, answeredBy: 3 }),
      mc("The derivative of a constant function is:", ["1", "The constant", "0", "Undefined"], "C",
        { objective: [1, 1], bloom: "Remember", target: 0.9, answeredBy: 0 }),
    ],
  },
];

// Every collection the seed writes to, for --reset and for the refresh.
const TAGGED_COLLECTIONS = [
  "grasp_student_performance",
  "grasp_student_attempt",
  "grasp_quiz_score",
  "grasp_quiz_session",
  "grasp_quiz_question",
  "grasp_quiz_section_schedule",
  "grasp_quiz",
  "grasp_question",
  "grasp_objective",
  "grasp_user_course_section",
  "grasp_course_section",
  "grasp_user_course",
  "grasp_course",
  "grasp_user",
];

// Deterministic PRNG (mulberry32) so every run produces the same answers.
function makeRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickWeighted(random, weights) {
  const entries = Object.entries(weights);
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = random() * total;
  for (const [key, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return key;
  }
  return entries[entries.length - 1][0];
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] || null;
}

async function resolveOwner(db) {
  const wanted = argValue("--owner");
  if (wanted) {
    const owner = await db.collection("grasp_user").findOne({ $or: [{ email: wanted }, { puid: wanted }] });
    if (!owner) throw new Error(`No user with email or puid "${wanted}".`);
    return owner;
  }
  const faculty = await db
    .collection("grasp_user")
    .find({ affiliation: "faculty", seedTag: { $ne: SEED_TAG } })
    .toArray();
  if (faculty.length !== 1) {
    throw new Error(
      `Found ${faculty.length} faculty users; pass --owner <email|puid> to choose the demo course owner.`
    );
  }
  return faculty[0];
}

async function removeSeedData(db) {
  const removed = {};
  for (const name of TAGGED_COLLECTIONS) {
    const { deletedCount } = await db.collection(name).deleteMany({ seedTag: SEED_TAG });
    if (deletedCount) removed[name] = deletedCount;
  }
  return removed;
}

async function seed(db, owner) {
  const random = makeRandom(RANDOM_SEED);
  const now = new Date();
  const daysAgo = (days) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const tag = { seedTag: SEED_TAG };

  const { insertedId: courseId } = await db.collection("grasp_course").insertOne({
    ...tag,
    courseCode: COURSE_CODE,
    courseName: COURSE_NAME,
    courseDescription: "Fake students and answers for trying out Analytics.",
    owner: owner._id,
    status: "active",
    archived: false,
    createdAt: now,
    updatedAt: now,
  });
  await db.collection("grasp_user_course").insertOne({ ...tag, userId: owner._id, courseId, createdAt: now });

  // Students, each with an ability that nudges their odds up or down, so
  // strong and weak students show through consistently across questions.
  const students = [];
  let number = 0;
  for (const section of SECTIONS) {
    await db.collection("grasp_course_section").insertOne({
      ...tag,
      courseId,
      sectionId: section.sectionId,
      sectionNumber: section.sectionNumber,
      academicPeriod: "AP-DEMO",
      academicPeriodName: "Demo Term",
      owner: owner._id,
      createdAt: now,
      updatedAt: now,
    });
    for (let i = 0; i < section.students; i += 1) {
      number += 1;
      const label = String(number).padStart(2, "0");
      const { insertedId: userId } = await db.collection("grasp_user").insertOne({
        ...tag,
        puid: `DEMO-ANALYTICS-${label}`,
        username: `demo_student_${label}`,
        displayName: `Demo Student ${label}`,
        legalName: `Demo Student ${label}`,
        email: `demo.student${label}@example.invalid`,
        affiliation: "student",
        registeredAt: now,
        updatedAt: now,
      });
      await db.collection("grasp_user_course").insertOne({ ...tag, userId, courseId, createdAt: now });
      await db.collection("grasp_user_course_section").insertOne({
        ...tag, userId, courseId, sectionId: section.sectionId,
      });
      students.push({ userId, ability: (random() - 0.5) * 0.3 });
    }
  }

  const objectiveIds = [];
  for (const objective of OBJECTIVES) {
    const { insertedId: parentId } = await db.collection("grasp_objective").insertOne({
      ...tag, courseId, name: objective.name, parent: 0, createdAt: now, updatedAt: now,
    });
    const granularIds = [];
    for (const name of objective.granular) {
      const { insertedId } = await db.collection("grasp_objective").insertOne({
        ...tag, courseId, name, parent: parentId, createdAt: now, updatedAt: now,
      });
      granularIds.push(insertedId);
    }
    objectiveIds.push({ parentId, granularIds });
  }

  const summary = { students: students.length, quizzes: 0, questions: 0, answers: 0, pending: 0 };

  // The adaptive engine's per-objective state (grasp_student_performance),
  // built the way saveStudentPerformance does: only a student's first graded
  // answer on an objective in each quiz moves it, a wrong one flags the
  // objective for remediation and resets the streak, a right one clears the
  // flag and extends it.
  const BLOOM_ORDER = ["Remember", "Understand", "Apply", "Analyze", "Evaluate", "Create"];
  const mastery = new Map();
  const recordMastery = (userId, question, quizId, isCorrect, at) => {
    const key = `${userId}|${question.parentId}`;
    const row = mastery.get(key) || {
      ...tag,
      userId,
      courseId,
      learningObjectiveId: question.parentId,
      timesCorrect: 0,
    };
    if (String(row.lastQuizIdSeen) === String(quizId)) return;
    row.lastQuizIdSeen = quizId;
    row.needsRemediation = !isCorrect;
    row.updatedAt = at;
    if (isCorrect) {
      row.timesCorrect += 1;
      if (BLOOM_ORDER.indexOf(question.bloom) > BLOOM_ORDER.indexOf(row.highestBloomPassed)) {
        row.highestBloomPassed = question.bloom;
      }
    } else {
      row.timesCorrect = 0;
      row.remediationBloomLevel = question.bloom;
    }
    mastery.set(key, row);
  };

  for (const [quizIndex, quizSpec] of QUIZZES.entries()) {
    const takenAt = daysAgo(14 - quizIndex * 7);
    const { insertedId: quizId } = await db.collection("grasp_quiz").insertOne({
      ...tag,
      courseId,
      name: quizSpec.name,
      description: "Seeded for the Analytics demo.",
      published: true,
      deliveryFormat: "all-approved",
      disablePreviousNavigation: false,
      timeLimitMinutes: 30,
      createdAt: takenAt,
      updatedAt: takenAt,
    });
    summary.quizzes += 1;

    const questions = [];
    for (const spec of quizSpec.questions) {
      const { objective, target, wrongWeights, answeredBy, pendingShare, ...fields } = spec;
      const { parentId, granularIds } = objectiveIds[objective[0]];
      const { insertedId: questionId } = await db.collection("grasp_question").insertOne({
        ...tag,
        ...fields,
        stem: fields.title,
        courseId,
        learningObjectiveId: parentId,
        granularObjectiveId: granularIds[objective[1]],
        status: "Approved",
        flagStatus: false,
        createdBy: "analytics-demo-seed",
        createdAt: takenAt,
        updatedAt: takenAt,
      });
      await db.collection("grasp_quiz_question").insertOne({ ...tag, quizId, questionId, createdAt: takenAt });
      questions.push({ ...spec, questionId, parentId, granularId: granularIds[objective[1]] });
      summary.questions += 1;
    }

    for (const section of SECTIONS) {
      const courseSection = await db.collection("grasp_course_section").findOne({ courseId, sectionId: section.sectionId });
      await db.collection("grasp_quiz_section_schedule").insertOne({
        ...tag,
        quizId,
        courseSectionId: courseSection._id,
        releaseDate: daysAgo(30),
        expireDate: daysAgo(-30),
        createdAt: takenAt,
        updatedAt: takenAt,
      });
    }

    // The first few students skip each quiz, so completion is not 100%.
    const takers = students.slice(quizSpec.skippedBy);
    const answeredCount = new Map();

    for (const student of takers) {
      const startedAt = new Date(takenAt.getTime() + random() * 6 * 60 * 60 * 1000);
      const timeSpent = Math.round((8 + random() * 18) * 60 * 1000);
      let correctAnswers = 0;

      for (const question of questions) {
        const seen = answeredCount.get(question) || 0;
        if (question.answeredBy !== undefined && seen >= question.answeredBy) continue;
        answeredCount.set(question, seen + 1);

        const odds = Math.min(0.99, Math.max(0.01, question.target + student.ability));
        let isCorrect = random() < odds;
        let selectedAnswer;
        let aiGraded = false;

        if (question.questionType === "multiple-choice") {
          const wrong = question.wrongWeights
            || Object.fromEntries(Object.keys(question.options).filter((k) => k !== question.correctAnswer).map((k) => [k, 1]));
          selectedAnswer = isCorrect ? question.correctAnswer : pickWeighted(random, wrong);
        } else if (question.questionType === "fill-in-the-blank") {
          selectedAnswer = isCorrect ? "removable" : pickWeighted(random, { jump: 3, infinite: 2, continuous: 1 });
        } else {
          selectedAnswer = isCorrect
            ? "The function is decreasing there, at a rate of 2 per unit of x."
            : "The function equals −2 at x = 3.";
          aiGraded = true;
          // Some open-ended answers are still awaiting grading.
          if (random() < (question.pendingShare || 0)) {
            isCorrect = null;
            summary.pending += 1;
          }
        }

        if (isCorrect === true) correctAnswers += 1;
        if (isCorrect !== null) recordMastery(student.userId, question, quizId, isCorrect, startedAt);
        await db.collection("grasp_student_attempt").insertOne({
          ...tag,
          userId: student.userId,
          courseId,
          quizId,
          questionId: question.questionId,
          learningObjectiveId: question.parentId,
          granularObjectiveId: question.granularId,
          bloom: question.bloom,
          isCorrect,
          selectedAnswer,
          correctAnswer: question.correctAnswer || null,
          questionType: question.questionType,
          aiGraded,
          isFirstAttempt: true,
          createdAt: startedAt,
        });
        summary.answers += 1;
      }

      const totalQuestions = questions.length;
      const submittedAt = new Date(startedAt.getTime() + timeSpent);
      await db.collection("grasp_quiz_session").insertOne({
        ...tag,
        userId: student.userId,
        quizId,
        startedAt,
        expiresAt: new Date(startedAt.getTime() + 30 * 60 * 1000),
        timeLimitMinutes: 30,
        scheduledExpiresAt: null,
        questionCount: totalQuestions,
        submittedAt,
      });
      await db.collection("grasp_quiz_score").insertOne({
        ...tag,
        userId: student.userId,
        quizId,
        courseId,
        score: Math.round((correctAnswers / totalQuestions) * 100),
        correctAnswers,
        totalQuestions,
        timeSpent,
        completedAt: submittedAt,
        createdAt: submittedAt,
      });
    }
  }

  if (mastery.size) {
    await db.collection("grasp_student_performance").insertMany([...mastery.values()]);
  }
  summary.flaggedForRemediation = [...mastery.values()].filter((row) => row.needsRemediation).length;

  return { courseId, summary };
}

async function main() {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB_NAME;
  if (!uri || !dbName) throw new Error("MONGODB_URI and MONGODB_DB_NAME must be set (see .env).");

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
  await client.connect();
  try {
    const db = client.db(dbName);
    console.log(`Database: ${dbName}`);

    const removed = await removeSeedData(db);
    if (Object.keys(removed).length) console.log("Removed previous demo data:", removed);

    if (process.argv.includes("--reset")) {
      console.log("Demo data removed.");
      return;
    }

    const owner = await resolveOwner(db);
    const { courseId, summary } = await seed(db, owner);
    console.log(`Created "${COURSE_NAME}" (${courseId}) owned by ${owner.displayName || owner.email || owner.puid}.`);
    console.log(summary);
    console.log("Select the course in the sidebar and open Analytics.");
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
