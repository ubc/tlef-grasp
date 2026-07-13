// @ts-check
const { expect } = require('@playwright/test');
const { MongoClient, ObjectId } = require('mongodb');
const { seedStudentJourneyCourse, SEED } = require('../e2e/seed');

const COURSE_KEY = 'grasp-selected-course';
const ROLE_KEY = 'grasp-current-role';
const IDP_ENABLED = process.env.E2E_SAML === '1';

function asObjectId(value) {
  return typeof value === 'string' && ObjectId.isValid(value)
    ? new ObjectId(value)
    : value;
}

async function seedCourseForUser(user) {
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is required to seed authenticated a11y data');
  }

  const client = new MongoClient(process.env.MONGODB_URI, {
    connectTimeoutMS: 5000,
    serverSelectionTimeoutMS: 5000,
  });

  await client.connect();
  try {
    const db = client.db(process.env.MONGODB_DB_NAME || 'grasp_db');
    const userId = asObjectId(user._id || user.id);
    const codePart = String(user.puid || user._id || 'user').replace(/\W/g, '');
    const courseCode = `A11Y-${codePart.slice(-12) || 'COURSE'}`;
    const now = new Date();

    await db.collection('grasp_course').updateOne(
      { courseCode },
      {
        $setOnInsert: {
          courseName: 'GRASP Accessibility Seed Course',
          courseCode,
          campus: 'ACADEMIC_UNIT-UBC-V',
          courseAccess: `a11y-${codePart.slice(-8) || 'course'}`,
          owner: userId,
          ubcCourseId: 'A11Y|100',
          createdAt: now,
          updatedAt: now,
        },
      },
      { upsert: true }
    );

    const course = await db.collection('grasp_course').findOne({ courseCode });
    const courseId = course._id;

    await db.collection('grasp_user_course').updateOne(
      { userId, courseId },
      { $setOnInsert: { userId, courseId, createdAt: now } },
      { upsert: true }
    );

    await db.collection('grasp_course_section').updateOne(
      { courseId, sectionId: 'A11Y-001' },
      {
        $setOnInsert: {
          courseId,
          sectionId: 'A11Y-001',
          sectionNumber: 'A11Y 001',
          academicPeriod: '2026W',
          academicPeriodName: '2026 Winter',
          owner: userId,
          createdAt: now,
          updatedAt: now,
        },
      },
      { upsert: true }
    );

    return { id: courseId.toString(), name: course.courseName };
  } finally {
    await client.close();
  }
}

async function getCurrentUser(page) {
  const response = await page.request.get('/api/current-user');
  expect(response.ok(), 'authenticated a11y user can read /api/current-user').toBe(
    true
  );
  const body = await response.json();
  return body.user;
}

async function getOrSeedCourse(page) {
  // Always use the per-user accessibility course. Picking the first course
  // makes owner-only UI depend on unrelated local database ordering.
  const user = await getCurrentUser(page);
  return seedCourseForUser(user);
}

async function selectCourse(page, course, role = 'instructor') {
  await page.addInitScript(
    ({ courseKey, roleKey, selectedCourse, selectedRole }) => {
      window.sessionStorage.setItem(courseKey, JSON.stringify(selectedCourse));
      window.localStorage.setItem(roleKey, selectedRole);
    },
    {
      courseKey: COURSE_KEY,
      roleKey: ROLE_KEY,
      selectedCourse: course,
      selectedRole: role,
    }
  );
}

async function prepareAuthenticatedCourse(page) {
  const course = await getOrSeedCourse(page);
  await selectCourse(page, course);
  return course;
}

function normalizeCourse(course) {
  return {
    id: String(course._id || course.id),
    name: course.courseName || course.name || 'Selected Course',
  };
}

// Look up the already-seeded course and select it as the instructor WITHOUT
// re-seeding. seedStudentJourneyCourse() wipes the AI quiz's attempt/score
// rows, so a flow where a student has just taken the quiz and the instructor
// then reviews it must not re-seed — that would delete the attempt under the
// instructor's feet (it would render as "Not Taken").
async function selectSeededInstructorCourse(page) {
  const response = await page.request.get('/api/courses/my');
  expect(response.ok(), 'instructor can read /api/courses/my').toBe(true);
  const body = await response.json();
  const course = (body.courses || []).find(
    (candidate) => (candidate.courseName || candidate.name) === SEED.COURSE_NAME
  );
  expect(course, `seeded instructor course "${SEED.COURSE_NAME}" is present`).toBeTruthy();

  const selected = normalizeCourse(course);
  await selectCourse(page, selected, 'instructor');
  return selected;
}

async function prepareSeededInstructorCourse(page) {
  await seedStudentJourneyCourse();
  return selectSeededInstructorCourse(page);
}

async function prepareSeededStudentCourse(page) {
  await seedStudentJourneyCourse();

  const response = await page.request.get('/api/student/courses');
  expect(response.ok(), 'student can read /api/student/courses').toBe(true);
  const body = await response.json();
  const course = (body.courses || []).find(
    (candidate) => (candidate.courseName || candidate.name) === SEED.COURSE_NAME
  );
  expect(course, `seeded student course "${SEED.COURSE_NAME}" is present`).toBeTruthy();

  const selected = normalizeCourse(course);
  await selectCourse(page, selected, 'student');
  return selected;
}

async function gotoCoursePage(page, path, readyLocator) {
  await prepareAuthenticatedCourse(page);
  await page.goto(path);
  await expect(page).toHaveURL(new RegExp(`${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[?#].*)?$`));
  await expect(readyLocator(page)).toBeVisible();
}

module.exports = {
  IDP_ENABLED,
  prepareAuthenticatedCourse,
  prepareSeededInstructorCourse,
  selectSeededInstructorCourse,
  prepareSeededStudentCourse,
  gotoCoursePage,
};
