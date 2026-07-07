// @ts-check
const { expect } = require('@playwright/test');
const { MongoClient, ObjectId } = require('mongodb');

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
  const coursesResponse = await page.request.get('/api/courses/my');
  expect(coursesResponse.ok(), 'authenticated a11y user can read /api/courses/my').toBe(
    true
  );
  const body = await coursesResponse.json();
  const existing = (body.courses || [])[0];
  if (existing) {
    return {
      id: String(existing._id || existing.id),
      name: existing.courseName || existing.name || 'Selected Course',
    };
  }

  const user = await getCurrentUser(page);
  return seedCourseForUser(user);
}

async function selectCourse(page, course) {
  await page.addInitScript(
    ({ courseKey, roleKey, selectedCourse }) => {
      window.sessionStorage.setItem(courseKey, JSON.stringify(selectedCourse));
      window.localStorage.setItem(roleKey, 'instructor');
    },
    {
      courseKey: COURSE_KEY,
      roleKey: ROLE_KEY,
      selectedCourse: course,
    }
  );
}

async function prepareAuthenticatedCourse(page) {
  const course = await getOrSeedCourse(page);
  await selectCourse(page, course);
  return course;
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
  gotoCoursePage,
};
