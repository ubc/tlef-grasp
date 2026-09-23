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

const { hasStaffAccessInCourse } = require('../../src/utils/course-access');
const { isAppAdministrator } = require('../../src/utils/auth');
const { getCourseById } = require('../../src/services/course');
const { getSectionsOwnedByUser } = require('../../src/services/course-section');
const lmsSectionLinkService = require('../../src/services/lms-section-link');
const { syncSectionRoster } = require('../../src/services/lms-roster-sync');
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
function recordingClient(calls) {
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
    post: jest.fn(async (p) => { record('POST', p); return {}; }),
    put: jest.fn(async (p) => { record('PUT', p); return {}; }),
    delete: jest.fn(async (p) => { record('DELETE', p); return {}; }),
    download: jest.fn(),
    uploadFile: jest.fn(),
  };
}

function buildApp(calls, capabilities) {
  // The real toolkit namespace, so getCourses/getCourseSections resolve their
  // own paths; only the auth pieces are swapped for a recording client.
  const canvas = {
    ...toolkitCanvas,
    createAuthRouter: () => express.Router(),
    requireAuth: () => (req, _res, next) => {
      req.canvasApi = recordingClient(calls);
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
  // Nothing calls the assignment endpoints yet (issue #113 item 4).
  assignments: [],
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
      sectionId: '101',
      lmsLink: {
        provider: 'canvas',
        instance: CANVAS_DOMAIN,
        externalCourseId: '42',
        externalSectionId: '501',
      },
    }]);
    lmsSectionLinkService.setCanvasSectionLink.mockResolvedValue({ provider: 'canvas' });
    syncSectionRoster.mockResolvedValue({ status: 'applied', summary: {} });
  });

  it.each(Object.keys(ROUTES_BY_CAPABILITY))(
    'every Canvas call made by a %s route is covered by that capability\'s scopes',
    async (capability) => {
      const calls = [];
      const app = buildApp(calls);

      for (const send of ROUTES_BY_CAPABILITY[capability]) {
        const response = await send(app);
        expect(response.status).toBe(200);
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

  it('the recommended UBC scopes enable linking and roster sync, and every call they make', async () => {
    const capabilities = resolveCanvasCapabilities(UBC_RECOMMENDED_SCOPES);
    expect(capabilities).toEqual({ link: true, rosterSync: true, assignments: false });

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
    const app = buildApp(calls, { link: false, rosterSync: false, assignments: false });

    for (const send of [...ROUTES_BY_CAPABILITY.link, ...ROUTES_BY_CAPABILITY.rosterSync]) {
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
    const EXERCISED_TOOLKIT_API_FUNCTIONS = new Set(['getCourses', 'getCourseSections']);
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
    expect(resolveCanvasCapabilities([])).toEqual({ link: true, rosterSync: true, assignments: true });
    expect(resolveCanvasCapabilities(undefined)).toEqual({ link: true, rosterSync: true, assignments: true });
  });

  it('enables a capability only when all of its scopes are requested', () => {
    expect(resolveCanvasCapabilities(['url:GET|/api/v1/courses'])).toEqual({
      link: false,
      rosterSync: false,
      assignments: false,
    });
    expect(resolveCanvasCapabilities([
      'url:GET|/api/v1/courses',
      'url:GET|/api/v1/courses/:course_id/enrollments',
    ])).toEqual({ link: false, rosterSync: true, assignments: false });
  });

  it('enables assignments once the four item-4 scopes are added to the recommended list', () => {
    expect(resolveCanvasCapabilities([
      ...UBC_RECOMMENDED_SCOPES,
      'url:POST|/api/v1/courses/:course_id/assignments',
      'url:GET|/api/v1/courses/:course_id/assignments/:assignment_id/overrides',
      'url:PUT|/api/v1/courses/:course_id/assignments/:assignment_id/overrides/:id',
      'url:POST|/api/v1/courses/:course_id/assignments/:assignment_id/overrides',
    ])).toEqual({ link: true, rosterSync: true, assignments: true });
  });
});
