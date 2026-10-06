// Canvas scopes (CANVAS_SCOPES) and the capabilities they enable
// (src/lms/canvas-scopes.js). On a developer key with Enforce Scopes, any Canvas
// API call outside the token's scopes fails with 401, so the scope map must list
// every endpoint GRASP calls. These tests keep code and map from drifting:
//   - every Canvas route runs against the REAL toolkit resource functions with a
//     recording API client, and each capability's calls must be covered by that
//     capability's own scopes;
//   - a static scan of src/ fails on any toolkit resource function or raw client
//     call that the recording tests do not know about.
const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');
const { canvas: toolkitCanvas } = require('@ubc/ubc-genai-toolkit-lms-integration');

jest.mock('../../src/utils/course-access', () => ({
  hasStaffAccessInCourse: jest.fn(),
}));

jest.mock('../../src/utils/auth', () => ({
  isAppAdministrator: jest.fn(),
}));

jest.mock('../../src/services/course', () => ({
  getCourseById: jest.fn(),
}));

jest.mock('../../src/services/course-section', () => ({
  getCourseSections: jest.fn(),
  getSectionsOwnedByUser: jest.fn(),
}));

jest.mock('../../src/services/lms-section-link', () => ({
  setCanvasSectionLink: jest.fn(),
}));

jest.mock('../../src/services/lms-roster-sync', () => ({
  syncSectionRoster: jest.fn(),
}));

jest.mock('../../src/services/material', () => ({
  findLmsImportedMaterials: jest.fn(),
}));

jest.mock('../../src/services/quiz', () => ({
  getQuizById: jest.fn(),
  getQuizzesByCourse: jest.fn(),
}));

jest.mock('../../src/services/quiz-schedule', () => ({
  getSchedulesForQuiz: jest.fn(),
  getSchedulesForSection: jest.fn(),
}));

// GRASP's own record of each quiz's Canvas assignment; the Mongo side is
// quiz-lms-assignment.service.test.js. The pure helpers stay real.
jest.mock('../../src/services/quiz-lms-assignment', () => ({
  ...jest.requireActual('../../src/services/quiz-lms-assignment'),
  getRowsForQuiz: jest.fn(),
  getRowsForSection: jest.fn(),
  claimRow: jest.fn(),
  releaseClaim: jest.fn(),
  markCreated: jest.fn(),
  markSynced: jest.fn(),
  markSyncFailed: jest.fn(),
  markDeclined: jest.fn(),
}));

// The import's parse/index/outline step; nothing in it talks to Canvas.
jest.mock('../../src/services/material-ingest', () => ({
  ingestMaterialFile: jest.fn(),
}));

jest.mock('../../src/utils/co-instructor-permissions', () => ({
  assertCoInstructorPermission: jest.fn(),
  isCourseManager: jest.fn(),
  PERMISSION_KEYS: { COURSE_MATERIALS: 'courseMaterials' },
}));

jest.mock('../../src/utils/ta-permissions', () => ({
  assertTaPermission: jest.fn(),
  TA_PERMISSION_KEYS: { COURSE_MATERIALS: 'courseMaterials' },
}));

const { hasStaffAccessInCourse } = require('../../src/utils/course-access');
const { isAppAdministrator } = require('../../src/utils/auth');
const { getCourseById } = require('../../src/services/course');
const { getSectionsOwnedByUser } = require('../../src/services/course-section');
const lmsSectionLinkService = require('../../src/services/lms-section-link');
const { syncSectionRoster } = require('../../src/services/lms-roster-sync');
const { findLmsImportedMaterials } = require('../../src/services/material');
const quizService = require('../../src/services/quiz');
const quizScheduleService = require('../../src/services/quiz-schedule');
const quizLmsAssignmentService = require('../../src/services/quiz-lms-assignment');
const { ingestMaterialFile } = require('../../src/services/material-ingest');
const { assertCoInstructorPermission } = require('../../src/utils/co-instructor-permissions');
const { assertTaPermission } = require('../../src/utils/ta-permissions');
const { createCanvasRouter } = require('../../src/routes/lms-canvas');
const {
  CANVAS_CAPABILITIES,
  CANVAS_CAPABILITY_SCOPES,
  parseCanvasScopes,
  resolveCanvasCapabilities,
} = require('../../src/lms/canvas-scopes');
const { canvasScopesFromEnv } = require('../../src/lms/canvas');

const CANVAS_DOMAIN = 'https://canvas.example.test';
const USER_ID = '507f1f77bcf86cd799439011';
const SECTION_BASE = '/api/lms/canvas/courses/course-1/sections/101';
const MATERIALS_BASE = '/api/lms/canvas/courses/course-1/materials/canvas-courses';

// The three scopes Canvas file import adds to a developer key (README "Canvas
// scopes"); it also uses url:GET|/api/v1/courses, which the key already has.
const FILE_IMPORT_SCOPES = [
  'url:GET|/api/v1/courses/:course_id/files',
  'url:GET|/api/v1/courses/:course_id/files/:id',
  'url:GET|/api/v1/files/:id/public_url',
];

const QUIZ_BASE = '/api/lms/canvas/courses/course-1/quizzes/quiz-1/assignments';
const SECTION_OBJECT_ID = 'sec-1';
const DUE_AT = new Date('2026-11-01T06:59:00Z');
// The assignment row a second POST finds: created earlier with an older due
// date, so the route takes the update path (PUT on the override).
const CREATED_ROW = {
  _id: 'row-1',
  status: 'created',
  externalAssignmentId: '9001',
  externalOverrideId: '77',
  dueAt: new Date('2026-10-25T06:59:00Z'),
};
let assignmentRows = new Map();

const CANVAS_FILE_BYTES = Buffer.from('%PDF-1.7 lecture notes');
const CANVAS_FILE = {
  id: 7001,
  display_name: 'Lecture 1.pdf',
  filename: 'Lecture+1.pdf',
  'content-type': 'application/pdf',
  size: CANVAS_FILE_BYTES.length,
  updated_at: '2026-09-01T16:00:00Z',
  // Not an /api/v1 path: no scope can cover it, so GRASP must not download from it.
  url: `${CANVAS_DOMAIN}/files/7001/download?download_frd=1`,
};
const CANVAS_FILE_PUBLIC_URL = `${CANVAS_DOMAIN}/files/7001/download?verifier=signed`;

// The value README/.env.example recommend for UBC's current production key.
const UBC_RECOMMENDED_SCOPES = [
  'url:GET|/api/v1/courses',
  'url:GET|/api/v1/courses/:course_id/sections',
  'url:GET|/api/v1/courses/:course_id/enrollments',
  'url:GET|/api/v1/courses/:course_id/assignments',
];

/**
 * Canvas's own check: a URL scope `url:METHOD|/api/v1/path/:param` covers a
 * request when the method matches and the path matches the route pattern
 * (each `:param` one path segment).
 */
function scopeCovers(scope, { method, path: requestPath }) {
  const match = /^url:([A-Z]+)\|(\/api\/v1\/\S+)$/.exec(scope);
  if (!match || match[1] !== method) return false;
  const pattern = match[2]
    .split('/')
    .map((segment) =>
      segment.startsWith(':') ? '[^/]+' : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    )
    .join('/');
  return new RegExp(`^${pattern}$`).test(requestPath);
}

const uncovered = (calls, scopes) =>
  calls.filter((call) => !scopes.some((scope) => scopeCovers(scope, call)));

// Canvas API responses, keyed by the path the toolkit's client resolves.
function cannedResponse(apiPath) {
  if (apiPath === '/api/v1/courses') {
    return [{ id: 42, name: 'Biology 302', course_code: 'BIOC 302' }];
  }
  if (/^\/api\/v1\/courses\/[^/]+\/sections$/.test(apiPath)) {
    return [{ id: 501, name: 'Section 1', course_id: 42 }];
  }
  // No assignment carries the quiz's name yet, so a create goes ahead.
  if (/^\/api\/v1\/courses\/[^/]+\/assignments$/.test(apiPath)) return [];
  if (/^\/api\/v1\/courses\/[^/]+\/assignments\/[^/]+\/overrides$/.test(apiPath)) {
    return [{ id: 77, assignment_id: 9001, course_section_id: 501, due_at: DUE_AT.toISOString() }];
  }
  if (/^\/api\/v1\/courses\/[^/]+\/files$/.test(apiPath)) return [CANVAS_FILE];
  if (/^\/api\/v1\/courses\/[^/]+\/files\/[^/]+$/.test(apiPath)) return CANVAS_FILE;
  if (/^\/api\/v1\/files\/[^/]+\/public_url$/.test(apiPath)) return { public_url: CANVAS_FILE_PUBLIC_URL };
  if (/^\/api\/v1\/courses\/[^/]+\/enrollments$/.test(apiPath)) {
    return [{
      id: 9001,
      user_id: 1,
      course_id: 42,
      course_section_id: 501,
      type: 'StudentEnrollment',
      enrollment_state: 'active',
      user: { id: 1, name: 'Ann Student', sortable_name: 'Student, Ann', integration_id: 'PUID1' },
    }];
  }
  return [];
}

// The toolkit's API client surface, recording { method, path } the way it
// resolves them (a relative path is under /api/v1).
function recordingClient(calls, downloads = []) {
  const resolve = (p) => {
    const bare = p.startsWith('/') ? p.slice(1) : p;
    return bare.startsWith('api/v1/') ? `/${bare}` : `/api/v1/${bare}`;
  };
  const record = (method, p) => {
    const apiPath = resolve(p);
    calls.push({ method, path: apiPath });
    return apiPath;
  };
  return {
    getAll: jest.fn(async (p) => cannedResponse(record('GET', p))),
    get: jest.fn(async (p) => cannedResponse(record('GET', p))),
    post: jest.fn(async (p) => {
      const apiPath = record('POST', p);
      if (/\/assignments$/.test(apiPath)) return { id: 9001, html_url: `${CANVAS_DOMAIN}/courses/42/assignments/9001` };
      if (/\/overrides$/.test(apiPath)) return { id: 78, course_section_id: 501 };
      return {};
    }),
    put: jest.fn(async (p) => { record('PUT', p); return { id: 77, due_at: DUE_AT.toISOString() }; }),
    delete: jest.fn(async (p) => { record('DELETE', p); return {}; }),
    // Not a Canvas API call: the bytes come from whatever URL this is handed.
    download: jest.fn(async (url, options) => {
      downloads.push({ url, options });
      return {
        data: new Uint8Array(CANVAS_FILE_BYTES),
        size: CANVAS_FILE_BYTES.length,
        contentType: 'application/pdf',
      };
    }),
    uploadFile: jest.fn(),
  };
}

function buildApp(calls, capabilities, downloads) {
  // The real toolkit namespace, so getCourses/getCourseSections resolve their
  // own paths; only the auth pieces are swapped for a recording client.
  const canvas = {
    ...toolkitCanvas,
    createAuthRouter: () => express.Router(),
    requireAuth: () => (req, _res, next) => {
      req.canvasApi = recordingClient(calls, downloads);
      next();
    },
  };
  const app = express();
  app.use((req, _res, next) => {
    req.user = { _id: USER_ID };
    next();
  });
  app.use('/api/lms/canvas', createCanvasRouter({ configured: true, canvas, config: {}, capabilities }));
  return app;
}

// Each Canvas route, grouped by the capability that gates it.
const ROUTES_BY_CAPABILITY = {
  link: [
    (app) => request(app).get(`${SECTION_BASE}/available-courses`),
    (app) => request(app).get(`${SECTION_BASE}/canvas-courses/42/sections`),
    (app) => request(app).put(`${SECTION_BASE}/link`).send({ canvasCourseId: '42', canvasSectionId: '501' }),
  ],
  rosterSync: [
    (app) => request(app).post(`${SECTION_BASE}/sync-students`).send({}),
  ],
  files: [
    (app) => request(app).get(MATERIALS_BASE),
    (app) => request(app).get(`${MATERIALS_BASE}/42/files`),
    (app) => request(app).post(`${MATERIALS_BASE}/42/files/7001/import`),
  ],
  assignments: [
    (app) => request(app).get(QUIZ_BASE),
    // No row yet: the create path.
    (app) => {
      assignmentRows = new Map();
      return request(app).post(QUIZ_BASE).send({ courseSectionIds: [SECTION_OBJECT_ID] });
    },
    // A row with an older due date: the update path.
    (app) => {
      assignmentRows = new Map([[SECTION_OBJECT_ID, CREATED_ROW]]);
      return request(app).post(QUIZ_BASE).send({ courseSectionIds: [SECTION_OBJECT_ID] });
    },
    (app) => request(app).put(`${QUIZ_BASE}/declined`).send({ courseSectionIds: [SECTION_OBJECT_ID] }),
    (app) => request(app).get(`${SECTION_BASE}/quiz-assignments`),
  ],
};

describe('Canvas scope coverage', () => {
  const originalDomain = process.env.CANVAS_DOMAIN;

  beforeAll(() => {
    process.env.CANVAS_DOMAIN = CANVAS_DOMAIN;
  });

  afterAll(() => {
    if (originalDomain === undefined) delete process.env.CANVAS_DOMAIN;
    else process.env.CANVAS_DOMAIN = originalDomain;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    hasStaffAccessInCourse.mockResolvedValue(true);
    isAppAdministrator.mockResolvedValue(false);
    getCourseById.mockResolvedValue({ _id: 'course-1', archived: false });
    getSectionsOwnedByUser.mockResolvedValue([{
      _id: SECTION_OBJECT_ID,
      sectionId: '101',
      sectionNumber: '101',
      lmsLink: {
        provider: 'canvas',
        instance: CANVAS_DOMAIN,
        externalCourseId: '42',
        externalSectionId: '501',
      },
    }]);
    lmsSectionLinkService.setCanvasSectionLink.mockResolvedValue({ provider: 'canvas' });
    syncSectionRoster.mockResolvedValue({ status: 'applied', summary: {} });
    assertCoInstructorPermission.mockResolvedValue(true);
    assertTaPermission.mockResolvedValue(true);
    findLmsImportedMaterials.mockResolvedValue([]);
    ingestMaterialFile.mockResolvedValue({ sourceId: 'source-1', documentTitle: 'Lecture 1.pdf' });
    quizService.getQuizById.mockResolvedValue({ _id: 'quiz-1', courseId: 'course-1', name: 'Quiz 1' });
    quizService.getQuizzesByCourse.mockResolvedValue([{ _id: 'quiz-1', courseId: 'course-1', name: 'Quiz 1' }]);
    quizScheduleService.getSchedulesForQuiz.mockResolvedValue([
      { courseSectionId: SECTION_OBJECT_ID, releaseDate: new Date('2026-10-01T07:00:00Z'), expireDate: DUE_AT },
    ]);
    quizScheduleService.getSchedulesForSection.mockResolvedValue([
      { quizId: 'quiz-1', releaseDate: new Date('2026-10-01T07:00:00Z'), expireDate: DUE_AT },
    ]);
    assignmentRows = new Map();
    quizLmsAssignmentService.getRowsForQuiz.mockImplementation(async () => assignmentRows);
    quizLmsAssignmentService.getRowsForSection.mockResolvedValue(new Map());
    quizLmsAssignmentService.claimRow.mockResolvedValue({ row: { _id: 'row-new' }, previousStatus: null });
    quizLmsAssignmentService.markDeclined.mockResolvedValue([SECTION_OBJECT_ID]);
  });

  it.each(Object.keys(ROUTES_BY_CAPABILITY))(
    'every Canvas call made by a %s route is covered by that capability\'s scopes',
    async (capability) => {
      const calls = [];
      const app = buildApp(calls);

      for (const send of ROUTES_BY_CAPABILITY[capability]) {
        const response = await send(app);
        expect([200, 201]).toContain(response.status);
      }

      expect(uncovered(calls, CANVAS_CAPABILITY_SCOPES[capability])).toEqual([]);
      if (ROUTES_BY_CAPABILITY[capability].length > 0) expect(calls.length).toBeGreaterThan(0);
    }
  );

  it('the roster sync reads enrollments, not the include-dependent users endpoint', async () => {
    const calls = [];
    await ROUTES_BY_CAPABILITY.rosterSync[0](buildApp(calls));

    expect(calls).toEqual([
      { method: 'GET', path: '/api/v1/courses' },
      { method: 'GET', path: '/api/v1/courses/42/enrollments' },
    ]);
  });

  it('a file import asks Canvas for a signed link and never downloads from the file\'s own URL', async () => {
    const calls = [];
    const downloads = [];
    const response = await ROUTES_BY_CAPABILITY.files[2](buildApp(calls, undefined, downloads));

    expect(response.status).toBe(201);
    expect(calls).toEqual([
      { method: 'GET', path: '/api/v1/courses' },
      // Once for the type and size checks, once by the toolkit's own
      // course-scoped lookup before it requests a link.
      { method: 'GET', path: '/api/v1/courses/42/files/7001' },
      { method: 'GET', path: '/api/v1/courses/42/files/7001' },
      { method: 'GET', path: '/api/v1/files/7001/public_url' },
    ]);
    // /files/:id/download is not an /api/v1 path, so no scope covers it: an
    // Enforce Scopes key is refused there. The signed link carries no token.
    expect(downloads).toEqual([
      { url: CANVAS_FILE_PUBLIC_URL, options: expect.objectContaining({ credentials: 'none' }) },
    ]);
  });

  it('adding the three file scopes to the recommended list enables file import, and every call it makes', async () => {
    const scopes = [...UBC_RECOMMENDED_SCOPES, ...FILE_IMPORT_SCOPES];
    const capabilities = resolveCanvasCapabilities(scopes);
    expect(capabilities).toEqual({ link: true, rosterSync: true, files: true, assignments: false });

    const calls = [];
    const app = buildApp(calls, capabilities);
    for (const send of ROUTES_BY_CAPABILITY.files) {
      expect([200, 201]).toContain((await send(app)).status);
    }
    expect(uncovered(calls, scopes)).toEqual([]);
    // Each of the three is needed: none is covered by another scope on the list.
    for (const scope of FILE_IMPORT_SCOPES) {
      expect(calls.some((call) => scopeCovers(scope, call))).toBe(true);
    }
  });

  it('creating an assignment searches by name, creates with the override inline, then reads the override id', async () => {
    const calls = [];
    const response = await ROUTES_BY_CAPABILITY.assignments[1](buildApp(calls));

    expect(response.status).toBe(200);
    expect(response.body.results).toEqual([{ courseSectionId: SECTION_OBJECT_ID, status: 'created' }]);
    expect(calls).toEqual([
      { method: 'GET', path: '/api/v1/courses' },
      { method: 'GET', path: '/api/v1/courses/42/assignments' },
      { method: 'POST', path: '/api/v1/courses/42/assignments' },
      { method: 'GET', path: '/api/v1/courses/42/assignments/9001/overrides' },
    ]);
  });

  it('rescheduling moves the override due date with one PUT', async () => {
    const calls = [];
    const response = await ROUTES_BY_CAPABILITY.assignments[2](buildApp(calls));

    expect(response.status).toBe(200);
    expect(response.body.results).toEqual([{ courseSectionId: SECTION_OBJECT_ID, status: 'updated' }]);
    expect(calls).toEqual([
      { method: 'GET', path: '/api/v1/courses' },
      { method: 'PUT', path: '/api/v1/courses/42/assignments/9001/overrides/77' },
    ]);
  });

  it('the recommended UBC scopes enable linking and roster sync, and every call they make', async () => {
    const capabilities = resolveCanvasCapabilities(UBC_RECOMMENDED_SCOPES);
    expect(capabilities).toEqual({ link: true, rosterSync: true, files: false, assignments: false });

    const calls = [];
    const app = buildApp(calls, capabilities);
    for (const send of [...ROUTES_BY_CAPABILITY.link, ...ROUTES_BY_CAPABILITY.rosterSync]) {
      expect((await send(app)).status).toBe(200);
    }
    expect(uncovered(calls, UBC_RECOMMENDED_SCOPES)).toEqual([]);
  });

  it('the recommended UBC scopes are a subset of UBC\'s production key', () => {
    const productionKey = new Set([
      'url:GET|/api/v1/users/:id',
      'url:GET|/api/v1/courses',
      'url:GET|/api/v1/courses/:course_id/sections',
      'url:GET|/api/v1/courses/:course_id/users',
      'url:GET|/api/v1/courses/:course_id/enrollments',
      'url:GET|/api/v1/courses/:course_id/assignments',
      'url:GET|/api/v1/courses/:course_id/assignments/:id',
      'url:GET|/api/v1/courses/:course_id/assignments/:assignment_id/submissions',
      'url:GET|/api/v1/courses/:course_id/assignments/:assignment_id/submissions/:user_id',
      'url:POST|/api/v1/courses/:course_id/assignments/:assignment_id/submissions/:user_id/comments/files',
      'url:PUT|/api/v1/courses/:course_id/assignments/:assignment_id/submissions/:user_id',
      'url:POST|/api/v1/courses/:course_id/assignments/:assignment_id/submissions/update_grades',
      'url:GET|/api/v1/progress/:id',
    ]);
    // Requesting a scope the key lacks fails the whole OAuth request.
    expect(UBC_RECOMMENDED_SCOPES.filter((scope) => !productionKey.has(scope))).toEqual([]);
  });

  it('a disabled capability refuses its routes before any Canvas call', async () => {
    const calls = [];
    const app = buildApp(calls, { link: false, rosterSync: false, files: false, assignments: false });

    for (const send of Object.values(ROUTES_BY_CAPABILITY).flat()) {
      const response = await send(app);
      expect(response.status).toBe(409);
      expect(response.body.code).toBe('capability-disabled');
    }
    expect(calls).toEqual([]);
  });

  describe('static scan of src/', () => {
    const SRC = path.join(__dirname, '../../src');
    // Toolkit Canvas functions that call the Canvas API, and whether the
    // recording tests above exercise them.
    const EXERCISED_TOOLKIT_API_FUNCTIONS = new Set([
      'getCourses', 'getCourseSections', 'getCourseFiles', 'downloadFile',
    ]);
    // Toolkit Canvas members that never call the Canvas REST API.
    const NON_API_TOOLKIT_MEMBERS = new Set([
      'requireAuth', 'ensureAuth', 'createAuthRouter', 'loadConfigFromEnv',
      'CanvasApiError', 'CanvasOAuthError',
    ]);

    function sourceFiles(dir) {
      return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return sourceFiles(full);
        return entry.name.endsWith('.js') ? [full] : [];
      });
    }

    const sources = sourceFiles(SRC).map((file) => ({
      file: path.relative(SRC, file),
      text: fs.readFileSync(file, 'utf8'),
    }));

    it('uses no toolkit Canvas API function the coverage tests do not exercise', () => {
      const unknown = [];
      for (const { file, text } of sources) {
        // Calls on the toolkit namespace, e.g. canvas.getCourses(req.canvasApi, …).
        for (const [, member] of text.matchAll(/\bcanvas\.([A-Za-z]\w*)\s*\(/g)) {
          if (!EXERCISED_TOOLKIT_API_FUNCTIONS.has(member) && !NON_API_TOOLKIT_MEMBERS.has(member)) {
            unknown.push(`${file}: canvas.${member}`);
          }
        }
      }
      // A new toolkit call must be added to ROUTES_BY_CAPABILITY (and its
      // endpoint to src/lms/canvas-scopes.js).
      expect(unknown).toEqual([]);
    });

    it('every raw Canvas client call in src/ is covered by some capability\'s scopes', () => {
      const allScopes = CANVAS_CAPABILITIES.flatMap((name) => CANVAS_CAPABILITY_SCOPES[name]);
      const METHODS = { getAll: 'GET', get: 'GET', post: 'POST', put: 'PUT', delete: 'DELETE' };
      const rawCalls = [];
      for (const { file, text } of sources) {
        const callPattern = /\b(?:client|canvasApi)\.(getAll|get|post|put|delete)\(\s*(['"`])([^'"`]+)\2/g;
        for (const [, fn, , literal] of text.matchAll(callPattern)) {
          const templated = literal.replace(/\$\{[^}]*\}/g, ':param');
          const bare = templated.startsWith('/') ? templated.slice(1) : templated;
          rawCalls.push({
            file,
            method: METHODS[fn],
            path: bare.startsWith('api/v1/') ? `/${bare}` : `/api/v1/${bare}`,
          });
        }
      }

      expect(rawCalls.map(({ method, path: p }) => `${method} ${p}`)).toContain(
        'GET /api/v1/courses/:param/enrollments'
      );
      expect(uncovered(rawCalls, allScopes)).toEqual([]);
    });
  });
});

describe('CANVAS_SCOPES parsing', () => {
  let warn;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it.each([[undefined], [''], ['   '], [' , ,\n']])('requests no scopes for %p', (value) => {
    expect(parseCanvasScopes(value)).toEqual([]);
  });

  it('accepts whitespace- and comma-separated lists, dropping duplicates in order', () => {
    const value = ` url:GET|/api/v1/courses,url:GET|/api/v1/courses/:course_id/sections
      url:GET|/api/v1/courses/:course_id/enrollments\turl:GET|/api/v1/courses , `;

    expect(parseCanvasScopes(value)).toEqual([
      'url:GET|/api/v1/courses',
      'url:GET|/api/v1/courses/:course_id/sections',
      'url:GET|/api/v1/courses/:course_id/enrollments',
    ]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('keeps an entry that is not a Canvas URL scope but warns about it', () => {
    expect(parseCanvasScopes('url:GET|/api/v1/courses courses:read')).toEqual([
      'url:GET|/api/v1/courses',
      'courses:read',
    ]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('courses:read'));
  });

  it('reads CANVAS_SCOPES from the environment', () => {
    expect(canvasScopesFromEnv({ CANVAS_SCOPES: 'url:GET|/api/v1/courses' })).toEqual([
      'url:GET|/api/v1/courses',
    ]);
    expect(canvasScopesFromEnv({})).toEqual([]);
  });
});

describe('Canvas capabilities', () => {
  it('enables everything when no scopes are requested (a key without Enforce Scopes)', () => {
    const all = { link: true, rosterSync: true, files: true, assignments: true };
    expect(resolveCanvasCapabilities([])).toEqual(all);
    expect(resolveCanvasCapabilities(undefined)).toEqual(all);
  });

  it('enables a capability only when all of its scopes are requested', () => {
    expect(resolveCanvasCapabilities(['url:GET|/api/v1/courses'])).toEqual({
      link: false,
      rosterSync: false,
      files: false,
      assignments: false,
    });
    expect(resolveCanvasCapabilities([
      'url:GET|/api/v1/courses',
      'url:GET|/api/v1/courses/:course_id/enrollments',
    ])).toEqual({ link: false, rosterSync: true, files: false, assignments: false });
  });

  it('enables assignments once the four item-4 scopes are added to the recommended list', () => {
    expect(resolveCanvasCapabilities([
      ...UBC_RECOMMENDED_SCOPES,
      'url:POST|/api/v1/courses/:course_id/assignments',
      'url:GET|/api/v1/courses/:course_id/assignments/:assignment_id/overrides',
      'url:PUT|/api/v1/courses/:course_id/assignments/:assignment_id/overrides/:id',
      'url:POST|/api/v1/courses/:course_id/assignments/:assignment_id/overrides',
    ])).toEqual({ link: true, rosterSync: true, files: false, assignments: true });
  });

  it('enables file import only with all three file scopes', () => {
    expect(resolveCanvasCapabilities([...UBC_RECOMMENDED_SCOPES, ...FILE_IMPORT_SCOPES]).files).toBe(true);
    for (const missing of FILE_IMPORT_SCOPES) {
      const scopes = [...UBC_RECOMMENDED_SCOPES, ...FILE_IMPORT_SCOPES.filter((scope) => scope !== missing)];
      expect(resolveCanvasCapabilities(scopes).files).toBe(false);
    }
  });
});
