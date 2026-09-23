const { ObjectId } = require('mongodb');
const databaseService = require('./database');
const { currentLmsInstance } = require('../lms/instance');

const CANVAS_PROVIDER = 'canvas';
const MOODLE_PROVIDER = 'moodle';

const toObjectId = (id) =>
  typeof id === 'string' && ObjectId.isValid(id) ? new ObjectId(id) : id;

// The last roster sync, without who ran it: when and what changed is enough
// for the browser.
function publicLastSync(lastSync) {
  if (!lastSync) return null;
  return {
    at: lastSync.at,
    added: Number(lastSync.added) || 0,
    restored: Number(lastSync.restored) || 0,
    dropped: Number(lastSync.dropped) || 0,
    kept: Number(lastSync.kept) || 0,
    unmatched: Number(lastSync.unmatched) || 0,
    dropsSkipped: lastSync.dropsSkipped || null,
    coverage: typeof lastSync.coverage === 'number' ? lastSync.coverage : null,
  };
}

function publicLmsLink(link) {
  if (!link) return null;
  return {
    provider: String(link.provider),
    instance: link.instance ? String(link.instance) : null,
    externalCourseId: String(link.externalCourseId),
    externalCourseName: String(link.externalCourseName || ''),
    externalCourseCode: String(link.externalCourseCode || ''),
    externalSectionId: String(link.externalSectionId),
    externalSectionName: String(link.externalSectionName || ''),
    linkedAt: link.linkedAt,
    lastSync: publicLastSync(link.lastSync),
  };
}

async function getSectionLmsLink(courseId, sectionId) {
  const db = await databaseService.connect();
  const section = await db.collection('grasp_course_section').findOne(
    { courseId: toObjectId(courseId), sectionId: String(sectionId) },
    { projection: { lmsLink: 1 } }
  );
  return publicLmsLink(section?.lmsLink);
}

async function setCanvasSectionLink(
  courseId,
  sectionId,
  canvasCourse,
  canvasSection,
  linkedBy
) {
  return setSectionLmsLink(
    courseId,
    sectionId,
    CANVAS_PROVIDER,
    canvasCourse,
    canvasSection,
    linkedBy
  );
}

async function setMoodleSectionLink(
  courseId,
  sectionId,
  moodleCourse,
  moodleGroup,
  linkedBy
) {
  return setSectionLmsLink(
    courseId,
    sectionId,
    MOODLE_PROVIDER,
    moodleCourse,
    moodleGroup,
    linkedBy
  );
}

async function setSectionLmsLink(
  courseId,
  sectionId,
  provider,
  externalCourse,
  externalSection,
  linkedBy
) {
  // Replaces the whole link on purpose: re-linking drops any previous
  // lastSync/dropsReviewedAt, so the next roster sync is a first sync again
  // and asks before dropping anyone.
  const link = {
    provider,
    externalCourseId: String(externalCourse.id),
    externalCourseName: String(externalCourse.name || ''),
    externalCourseCode: String(externalCourse.code || ''),
    externalSectionId: String(externalSection.id),
    externalSectionName: String(externalSection.name || ''),
    linkedBy: toObjectId(linkedBy),
    linkedAt: new Date(),
  };
  const instance = currentLmsInstance(provider);
  if (instance) link.instance = instance;

  const db = await databaseService.connect();
  const result = await db.collection('grasp_course_section').updateOne(
    { courseId: toObjectId(courseId), sectionId: String(sectionId) },
    { $set: { lmsLink: link, updatedAt: new Date() } }
  );
  return result.matchedCount === 1 ? publicLmsLink(link) : null;
}

async function removeSectionLmsLink(courseId, sectionId) {
  const db = await databaseService.connect();
  const result = await db.collection('grasp_course_section').updateOne(
    { courseId: toObjectId(courseId), sectionId: String(sectionId) },
    {
      $unset: { lmsLink: '' },
      $set: { updatedAt: new Date() },
    }
  );
  return result.matchedCount === 1;
}

module.exports = {
  publicLmsLink,
  getSectionLmsLink,
  setCanvasSectionLink,
  setMoodleSectionLink,
  removeSectionLmsLink,
};
