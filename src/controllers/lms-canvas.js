const lmsSectionLinkService = require('../services/lms-section-link');
const lmsRosterSyncService = require('../services/lms-roster-sync');
const { getCourseSections, getSectionsOwnedByUser } = require('../services/course-section');
const { findLmsImportedMaterials } = require('../services/material');
const {
  MAX_MATERIAL_FILE_BYTES,
  SUPPORTED_MATERIAL_MIME_TYPES,
  MaterialIngestError,
  materialFileKind,
  unsupportedTypeMessage,
} = require('../utils/material-file-types');
const { isAppAdministrator } = require('../utils/auth');
const { getLmsAdapter } = require('../lms/adapters');
const { canvasApiErrorResponse } = require('../lms/canvas-errors');
const { currentLmsInstance } = require('../lms/instance');
const { LmsRosterError, ROSTER_ERROR_CODES } = require('../lms/roster-errors');

const CANVAS_PROVIDER = 'canvas';
// A confirmed drop list is a list of GRASP user ids; bound it so a request
// body cannot grow without limit.
const MAX_CONFIRM_DROP_IDS = 5000;

const NOT_TEACHER_ERROR = 'Your connected Canvas account does not teach that course';
const NOT_LINKED_ERROR =
  'That Canvas course is not linked to one of your sections in this course';
const FILE_TOO_LARGE_ERROR = 'This Canvas file is over the 50 MB limit for course materials.';
const ALREADY_IMPORTED_ERROR = 'This Canvas file has already been imported into this course.';

const MONGO_DUPLICATE_KEY = 11000;

// One Canvas Files API object, reduced to what the import needs. `display_name`
// is the name instructors see; `filename` is Canvas's URL-encoded storage name.
function importableCanvasFile(file) {
  const name = String(file.display_name || file.filename || `Canvas file ${file.id}`);
  const mimeType = file['content-type'] || file.content_type || '';
  return {
    id: String(file.id),
    name,
    mimeType: String(mimeType),
    kind: materialFileKind({ fileName: name, mimeType }),
    size: typeof file.size === 'number' ? file.size : null,
    updatedAt: file.updated_at || null,
  };
}

// What the browser may know about a material a Canvas file was imported as.
function publicImport(material) {
  return {
    sourceId: String(material.sourceId),
    documentTitle: String(material.documentTitle || ''),
    importedAt: material.lms?.importedAt || null,
  };
}

// The toolkit hands back a Uint8Array; the parsers want a Buffer over the same
// bytes, not a second copy of a file that may be 50 MB.
function toBuffer(data) {
  return Buffer.isBuffer(data) ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
}

/**
 * Validate the sync request body.
 * @returns {{ error: string } | { confirmDropUserIds?: string[], skipDrops: boolean }}
 */
function parseSyncBody(body) {
  const { confirmDropUserIds, skipDrops } = body || {};
  if (skipDrops !== undefined && typeof skipDrops !== 'boolean') {
    return { error: 'skipDrops must be a boolean' };
  }
  if (confirmDropUserIds !== undefined) {
    if (
      !Array.isArray(confirmDropUserIds) ||
      confirmDropUserIds.length > MAX_CONFIRM_DROP_IDS ||
      !confirmDropUserIds.every((id) => typeof id === 'string' && id.trim().length > 0)
    ) {
      return { error: 'confirmDropUserIds must be an array of user ids' };
    }
    if (skipDrops === true) {
      return { error: 'Send either confirmDropUserIds or skipDrops, not both' };
    }
  }
  return {
    confirmDropUserIds: confirmDropUserIds?.map((id) => id.trim()),
    skipDrops: skipDrops === true,
  };
}

// Typed roster failures: in every case nothing was applied.
function sendRosterError(error, res) {
  if (error.code === ROSTER_ERROR_CODES.NO_INTEGRATION_IDS) {
    return res.status(422).json({
      success: false,
      code: error.code,
      error:
        'Canvas returned this section\'s students without their SIS integration IDs, so none of them ' +
        'could be matched to GRASP accounts. Your Canvas role needs permission to view SIS data ' +
        '(integration IDs). Nothing was changed.',
    });
  }
  if (error.code === ROSTER_ERROR_CODES.SECTION_SCOPE_UNAVAILABLE) {
    return res.status(502).json({
      success: false,
      code: error.code,
      error:
        'Canvas did not return the section of each enrollment, so GRASP could not tell which ' +
        'students are in this section. Nothing was changed.',
    });
  }
  return res.status(409).json({
    success: false,
    code: error.code,
    error: 'Students cannot be synced from this LMS. Nothing was changed.',
  });
}

function createCanvasController(canvas, { capabilities } = {}) {
  function getStatus(_req, res) {
    res.json({
      success: true,
      configured: true,
      connected: true,
      canvasDomain: process.env.CANVAS_DOMAIN,
      // Which Canvas features this deployment's CANVAS_SCOPES enable; the
      // client hides the others.
      capabilities: {
        link: capabilities?.link !== false,
        rosterSync: capabilities?.rosterSync !== false,
        files: capabilities?.files !== false,
        assignments: capabilities?.assignments !== false,
      },
    });
  }

  async function listAvailableCourses(req, res, next) {
    try {
      const courses = await getTeacherCourses(req.canvasApi);
      res.json({ success: true, courses: courses.map(publicCourse) });
    } catch (error) {
      sendCanvasApiError(error, res, next);
    }
  }

  async function listCanvasSections(req, res, next) {
    try {
      const canvasCourseId = String(req.params.canvasCourseId);
      const courses = await getTeacherCourses(req.canvasApi);
      if (!courses.some((course) => String(course.id) === canvasCourseId)) {
        return res.status(403).json({
          success: false,
          error: NOT_TEACHER_ERROR,
        });
      }

      const sections = await canvas.getCourseSections(
        req.canvasApi,
        canvasCourseId
      );
      res.json({
        success: true,
        sections: sections.map(({ id, name, courseId }) => ({
          id: String(id),
          name: String(name || ''),
          courseId: String(courseId),
        })),
      });
    } catch (error) {
      sendCanvasApiError(error, res, next);
    }
  }

  async function setSectionLink(req, res, next) {
    try {
      const canvasCourseId = String(req.body?.canvasCourseId || '').trim();
      const requestedSectionId = String(req.body?.canvasSectionId || '').trim();
      if (!canvasCourseId) {
        return res.status(400).json({
          success: false,
          error: 'Canvas course ID is required',
        });
      }

      const courses = await getTeacherCourses(req.canvasApi);
      const selectedCourse = courses.find(
        (course) => String(course.id) === canvasCourseId
      );
      if (!selectedCourse) {
        return res.status(403).json({
          success: false,
          error: NOT_TEACHER_ERROR,
        });
      }

      const sections = await canvas.getCourseSections(req.canvasApi, canvasCourseId);
      if (sections.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'That Canvas course has no sections available to link',
        });
      }
      if (sections.length > 1 && !requestedSectionId) {
        return res.status(400).json({
          success: false,
          error: 'Select a Canvas section',
        });
      }

      const selectedSection = sections.length === 1 && !requestedSectionId
        ? sections[0]
        : sections.find((section) => String(section.id) === requestedSectionId);
      if (!selectedSection) {
        return res.status(400).json({
          success: false,
          error: 'The selected Canvas section is not part of that course',
        });
      }

      const userId = req.user?._id || req.user?.id;
      const link = await lmsSectionLinkService.setCanvasSectionLink(
        req.params.courseId,
        req.params.sectionId,
        selectedCourse,
        selectedSection,
        userId
      );
      if (!link) {
        return res.status(404).json({
          success: false,
          error: 'GRASP section not found',
        });
      }

      res.json({ success: true, link });
    } catch (error) {
      sendCanvasApiError(error, res, next);
    }
  }

  /**
   * POST /courses/:courseId/sections/:sectionId/sync-students
   * Sync the linked Canvas section's students into this GRASP section, using
   * the clicking instructor's own Canvas token. Body:
   * { confirmDropUserIds?: string[], skipDrops?: boolean }.
   */
  async function syncSectionStudents(req, res, next) {
    try {
      const section = req.localCourseSection;
      const link = section?.lmsLink;
      if (link?.provider !== CANVAS_PROVIDER) {
        return res.status(409).json({
          success: false,
          error: 'This section is not linked to Canvas.',
        });
      }

      const instance = currentLmsInstance(CANVAS_PROVIDER);
      // Legacy links carry no instance and are taken to be this deployment's
      // Canvas; the sync backfills it.
      if (link.instance && link.instance !== instance) {
        return res.status(409).json({
          success: false,
          error: 'This section is linked to a different Canvas instance. Re-link it.',
        });
      }

      const body = parseSyncBody(req.body);
      if (body.error) {
        return res.status(400).json({ success: false, error: body.error });
      }

      // Linking checked this once; the token may belong to someone else now
      // (a co-owner, an administrator) or the enrollment may have ended.
      const courses = await getTeacherCourses(req.canvasApi);
      if (!courses.some((course) => String(course.id) === String(link.externalCourseId))) {
        return res.status(403).json({ success: false, error: NOT_TEACHER_ERROR });
      }

      const { roster, coverage } = await getLmsAdapter(CANVAS_PROVIDER).getSectionRoster({
        client: req.canvasApi,
        link,
      });

      const result = await lmsRosterSyncService.syncSectionRoster({
        courseId: req.params.courseId,
        section,
        provider: CANVAS_PROVIDER,
        instance,
        roster,
        coverage,
        actorUserId: req.user?._id || req.user?.id,
        confirmDropUserIds: body.confirmDropUserIds,
        skipDrops: body.skipDrops,
      });

      res.json({ success: true, ...result });
    } catch (error) {
      if (error instanceof LmsRosterError) return sendRosterError(error, res);
      sendCanvasApiError(error, res, next);
    }
  }

  /**
   * GET /courses/:courseId/materials/canvas-courses
   * The Canvas courses this instructor can import course materials from. Read
   * from GRASP's own section links; Canvas is not asked anything until one of
   * them is opened.
   */
  async function listMaterialImportCourses(req, res, next) {
    try {
      res.json({ success: true, courses: await linkedCanvasCourses(req) });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /courses/:courseId/materials/canvas-courses/:canvasCourseId/files
   * The Canvas course's files that can become course materials, newest first:
   * the types GRASP can parse, each marked when it is already a material here.
   */
  async function listMaterialImportFiles(req, res, next) {
    try {
      const course = await authorizeImportCourse(req, res);
      if (!course) return;

      const [canvasFiles, imported] = await Promise.all([
        canvas.getCourseFiles(req.canvasApi, course.id, {
          contentTypes: SUPPORTED_MATERIAL_MIME_TYPES,
          sort: 'updated_at',
          order: 'desc',
        }),
        findLmsImportedMaterials(req.params.courseId, importSource(course.id)),
      ]);
      const files = canvasFiles
        .map((file) => importableCanvasFile(file.raw))
        .filter((file) => file.kind);

      const importedByFileId = new Map(
        imported.map((material) => [String(material.lms.externalFileId), material])
      );
      // Replacing a file in Canvas gives it a new id and retires the old one,
      // so a new version of an imported file arrives looking like a file never
      // seen before. Recognise it by name once its old id has left the course.
      const listedIds = new Set(files.map((file) => file.id));
      const retiredByName = new Map(
        imported
          .filter((material) => !listedIds.has(String(material.lms.externalFileId)))
          .map((material) => [material.lms.externalFileName, material])
      );

      res.json({
        success: true,
        course,
        maxFileBytes: MAX_MATERIAL_FILE_BYTES,
        files: files.map((file) => {
          const material = importedByFileId.get(file.id);
          const earlier = material ? null : retiredByName.get(file.name);
          return {
            ...file,
            tooLarge: file.size !== null && file.size > MAX_MATERIAL_FILE_BYTES,
            imported: material ? publicImport(material) : null,
            replacesImported: earlier ? publicImport(earlier) : null,
          };
        }),
      });
    } catch (error) {
      sendCanvasApiError(error, res, next);
    }
  }

  /**
   * POST /courses/:courseId/materials/canvas-courses/:canvasCourseId/files/:canvasFileId/import
   * Download one Canvas course file with the instructor's own token and add it
   * to Course Materials through the same step as an uploaded file.
   */
  async function importMaterialFile(req, res, next) {
    const { courseId } = req.params;
    try {
      const course = await authorizeImportCourse(req, res);
      if (!course) return;

      // Name, type and size first, read inside the course, so a file that
      // cannot be imported is refused before any of it is downloaded.
      const file = importableCanvasFile(
        await req.canvasApi.get(
          `/courses/${encodeURIComponent(course.id)}/files/${encodeURIComponent(String(req.params.canvasFileId))}`
        )
      );

      const existing = await findImportedFile(courseId, course.id, file.id);
      if (existing) return sendAlreadyImported(res, existing);

      if (!file.kind) {
        return res.status(400).json({
          success: false,
          code: 'unsupported-type',
          error: unsupportedTypeMessage({ fileName: file.name, mimeType: file.mimeType }),
        });
      }
      if (file.size !== null && file.size > MAX_MATERIAL_FILE_BYTES) {
        return res.status(400).json({ success: false, code: 'too-large', error: FILE_TOO_LARGE_ERROR });
      }

      // Through a signed public_url link: the file's own /files/:id/download
      // URL is not an /api/v1 path, so a token from a developer key with
      // Enforce Scopes on is refused there.
      const download = await canvas.downloadFile(req.canvasApi, course.id, file.id, {
        maxBytes: MAX_MATERIAL_FILE_BYTES,
        via: 'public-url',
      });
      const buffer = toBuffer(download.data);

      // Required here rather than at the top: it loads the parsers, the vector
      // store and the LLM client, which no other Canvas route needs.
      const { ingestMaterialFile } = require('../services/material-ingest');
      const material = await ingestMaterialFile({
        courseId,
        buffer,
        fileName: file.name,
        mimeType: file.mimeType,
        size: buffer.length,
        documentTitle: file.name,
        lms: {
          ...importSource(course.id),
          externalFileId: file.id,
          externalFileName: file.name,
          externalUpdatedAt: file.updatedAt,
          importedAt: new Date(),
        },
      });

      res.status(201).json({
        success: true,
        material: { sourceId: material.sourceId, documentTitle: material.documentTitle },
      });
    } catch (error) {
      if (error instanceof MaterialIngestError) {
        return res.status(400).json({ success: false, code: error.code, error: error.message });
      }
      // Two imports of the same file raced; the unique index kept one.
      if (error?.code === MONGO_DUPLICATE_KEY) {
        return sendAlreadyImported(res, null);
      }
      if (error instanceof canvas.CanvasApiError) {
        // The download stopped at the size cap (Canvas reported no size, or a
        // wrong one, up front).
        if (error.statusCode === 413) {
          return res.status(400).json({ success: false, code: 'too-large', error: FILE_TOO_LARGE_ERROR });
        }
        return sendCanvasApiError(error, res, next);
      }
      // Parsing or indexing failed: nothing to do with Canvas.
      console.error('Error importing a Canvas file as course material:', error);
      res.status(500).json({
        success: false,
        error: 'GRASP could not process this file. Please try again.',
      });
    }
  }

  function sendAlreadyImported(res, material) {
    return res.status(409).json({
      success: false,
      code: 'already-imported',
      error: ALREADY_IMPORTED_ERROR,
      ...(material ? { material: publicImport(material) } : {}),
    });
  }

  // How GRASP identifies a Canvas course as the source of imported materials.
  function importSource(canvasCourseId) {
    return {
      provider: CANVAS_PROVIDER,
      instance: currentLmsInstance(CANVAS_PROVIDER),
      externalCourseId: String(canvasCourseId),
    };
  }

  async function findImportedFile(courseId, canvasCourseId, canvasFileId) {
    const [material] = await findLmsImportedMaterials(courseId, {
      ...importSource(canvasCourseId),
      externalFileId: canvasFileId,
    });
    return material || null;
  }

  // GRASP links sections, not courses, so one GRASP course can point at more
  // than one Canvas course. An instructor imports from the Canvas courses
  // their own linked sections point to (an app administrator: any section's,
  // as for linking), on this deployment's Canvas only.
  async function linkedCanvasCourses(req) {
    const { courseId } = req.params;
    const sections = (await isAppAdministrator(req.user))
      ? await getCourseSections(courseId)
      : await getSectionsOwnedByUser(courseId, req.user?._id || req.user?.id);

    const instance = currentLmsInstance(CANVAS_PROVIDER);
    const courses = new Map();
    for (const { lmsLink: link } of sections) {
      if (link?.provider !== CANVAS_PROVIDER) continue;
      // Legacy links carry no instance and are taken to be this deployment's.
      if (link.instance && link.instance !== instance) continue;
      const id = String(link.externalCourseId);
      if (!courses.has(id)) {
        courses.set(
          id,
          publicCourse({ id, name: link.externalCourseName, code: link.externalCourseCode })
        );
      }
    }
    return [...courses.values()];
  }

  // The two checks every file route makes before it reads a Canvas course: the
  // course is one this instructor's linked sections point to, and their Canvas
  // account still teaches it (the token may belong to someone whose enrollment
  // has ended since the section was linked). Answers 403 and returns null
  // otherwise.
  async function authorizeImportCourse(req, res) {
    const canvasCourseId = String(req.params.canvasCourseId);
    const linked = (await linkedCanvasCourses(req)).find((course) => course.id === canvasCourseId);
    if (!linked) {
      res.status(403).json({ success: false, error: NOT_LINKED_ERROR });
      return null;
    }
    const teaching = await getTeacherCourses(req.canvasApi);
    if (!teaching.some((course) => String(course.id) === canvasCourseId)) {
      res.status(403).json({ success: false, error: NOT_TEACHER_ERROR });
      return null;
    }
    return linked;
  }

  function getTeacherCourses(canvasApi) {
    return canvas.getCourses(canvasApi, { enrollment_type: 'teacher' });
  }

  function publicCourse({ id, name, code }) {
    return {
      id: String(id),
      name: String(name || ''),
      code: String(code || ''),
    };
  }

  function sendCanvasApiError(error, res, next) {
    const response = canvasApiErrorResponse(canvas, error);
    if (!response) return next(error);
    return res.status(response.status).json(response.body);
  }

  return {
    getStatus,
    listAvailableCourses,
    listCanvasSections,
    setSectionLink,
    syncSectionStudents,
    listMaterialImportCourses,
    listMaterialImportFiles,
    importMaterialFile,
  };
}

module.exports = { createCanvasController };
