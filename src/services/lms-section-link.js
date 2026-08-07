const { ObjectId } = require('mongodb');
const databaseService = require('./database');

const CANVAS_PROVIDER = 'canvas';

const toObjectId = (id) =>
  typeof id === 'string' && ObjectId.isValid(id) ? new ObjectId(id) : id;

function publicLmsLink(link) {
  if (!link) return null;
  return {
    provider: String(link.provider),
    externalCourseId: String(link.externalCourseId),
    externalCourseName: String(link.externalCourseName || ''),
    externalCourseCode: String(link.externalCourseCode || ''),
    externalSectionId: String(link.externalSectionId),
    externalSectionName: String(link.externalSectionName || ''),
    linkedAt: link.linkedAt,
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
  const link = {
    provider: CANVAS_PROVIDER,
    externalCourseId: String(canvasCourse.id),
    externalCourseName: String(canvasCourse.name || ''),
    externalCourseCode: String(canvasCourse.code || ''),
    externalSectionId: String(canvasSection.id),
    externalSectionName: String(canvasSection.name || ''),
    linkedBy: toObjectId(linkedBy),
    linkedAt: new Date(),
  };

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
  getSectionLmsLink,
  setCanvasSectionLink,
  removeSectionLmsLink,
};
