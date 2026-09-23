// An in-repo fake of the slice of the Canvas REST API that GRASP calls, for
// the e2e suite. GRASP talks to it through the real LMS toolkit client (bearer
// token, per_page, Link-header pagination), exactly as it would talk to
// Canvas: nothing in src/ knows it is a fake. Only CANVAS_DOMAIN points here.
//
// Canvas endpoints (JSON shapes follow the Canvas REST API docs):
//   GET  /api/v1/courses                      ?enrollment_type=teacher
//   GET  /api/v1/courses/:id/sections
//   GET  /api/v1/courses/:id/enrollments      ?type[]=…&state[]=…&section_ids[]=…
//   POST /login/oauth2/token                  always refuses (see below)
//
// Canvas behaviour it reproduces on purpose:
//   - every API list is paginated; per_page is capped (MAX_PER_PAGE) below what
//     the toolkit asks for, and the rest is reachable only through `Link`;
//   - an unknown token, and a caller who does not teach the course, both get
//     401 (Canvas answers "not authorized" with 401, not 403);
//   - sis_user_id / integration_id / login_id are present only when the
//     caller's role may read SIS data (`readSis`);
//   - every enrollment embeds its `user` (Canvas always includes it on this
//     endpoint); type[] / state[] filter the enrollments (state defaults to
//     active + invited, as in Canvas);
//   - enforced scopes (off by default, like a developer key without "Enforce
//     Scopes"; on through the control API): a call outside the token's scopes
//     gets 401 "Insufficient scopes on access token." WITHOUT a WWW-Authenticate
//     header, and include[] / includes[] are stripped down to `uuid`, as Canvas
//     does for a scoped key without "Allow Include Parameters".
//
// Control API for specs (tests/e2e/fake-canvas-client.js wraps it):
//   GET    /__e2e/health
//   POST   /__e2e/reset                              back to the fixtures, request log cleared
//   PUT    /__e2e/sections/:sectionId/students       { userIds: ['2001', …] }
//   PUT    /__e2e/permissions                        { readSis: boolean }
//   PUT    /__e2e/scopes                             { scopes: ['url:GET|/api/v1/…', …] | null }
//   GET    /__e2e/requests                           the recorded Canvas API requests
//   DELETE /__e2e/requests
//
// It is started inside the GRASP e2e server process by
// tests/e2e/start-server-with-stubs.js when E2E_FAKE_CANVAS_PORT is set.

const http = require('http');
const { FAKE_CANVAS, defaultCanvasFixtures } = require('./fake-canvas-fixtures');

const DEFAULT_PER_PAGE = 10;
const MAX_BODY_BYTES = 64 * 1024;
const ROSTER_STATES = ['active', 'invited'];
// The include values a scoped key without "Allow Include Parameters" keeps.
const SCOPED_ALLOWED_INCLUDES = new Set(['uuid']);
const SCOPE_PATTERN = /^url:(GET|POST|PUT|PATCH|DELETE)\|(\/api\/v1\/\S+)$/;

// Canvas's enrollment_type values → enrollment `type`.
const ENROLLMENT_TYPES = {
  student: 'StudentEnrollment',
  teacher: 'TeacherEnrollment',
  ta: 'TaEnrollment',
  observer: 'ObserverEnrollment',
  designer: 'DesignerEnrollment',
  student_view: 'StudentViewEnrollment',
};
// Lower-case `type` Canvas uses on the enrollments nested in a course object.
const COURSE_ENROLLMENT_TYPE = {
  StudentEnrollment: 'student',
  TeacherEnrollment: 'teacher',
  TaEnrollment: 'ta',
  ObserverEnrollment: 'observer',
  DesignerEnrollment: 'designer',
  StudentViewEnrollment: 'student',
};
const ROLE_IDS = {
  StudentEnrollment: 3,
  TeacherEnrollment: 4,
  TaEnrollment: 5,
  DesignerEnrollment: 6,
  ObserverEnrollment: 7,
  StudentViewEnrollment: 3,
};
const INSTRUCTOR_TYPES = new Set(['TeacherEnrollment', 'TaEnrollment']);

function sendJson(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    ...headers,
  });
  res.end(payload);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) return resolve({});
      try {
        resolve(JSON.parse(text));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

// Rails-style array params: accept both `key[]=a&key[]=b` and a bare `key=a`.
function listParam(searchParams, key) {
  return [...searchParams.getAll(`${key}[]`), ...searchParams.getAll(key)].filter(Boolean);
}

// A Canvas URL scope as a matcher: `:param` matches one path segment and an
// optional `.json` format suffix is allowed, as in Canvas's route-based check.
function compileScope(scope) {
  const match = SCOPE_PATTERN.exec(String(scope));
  if (!match) return null;
  const pattern = match[2]
    .split('/')
    .map((segment) =>
      segment.startsWith(':') ? '[^/]+' : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    )
    .join('/');
  return { method: match[1], regex: new RegExp(`^${pattern}(\\.json)?$`) };
}

// Strip include[] / includes[] to what a scoped key keeps.
function stripIncludes(searchParams) {
  for (const key of ['include[]', 'include', 'includes[]', 'includes']) {
    const kept = searchParams.getAll(key).filter((value) => SCOPED_ALLOWED_INCLUDES.has(value));
    searchParams.delete(key);
    for (const value of kept) searchParams.append(key, value);
  }
}

function createFakeCanvas() {
  let state = defaultCanvasFixtures();
  let requests = [];

  const userById = (id) => state.users.find((user) => String(user.id) === String(id));
  const courseById = (id) => state.courses.find((course) => String(course.id) === String(id));

  function teaches(userId, courseId) {
    return state.enrollments.some(
      (e) =>
        String(e.user_id) === String(userId) &&
        String(e.course_id) === String(courseId) &&
        INSTRUCTOR_TYPES.has(e.type) &&
        e.enrollment_state === 'active'
    );
  }

  function enrollmentJson(enrollment) {
    return {
      id: enrollment.id,
      user_id: enrollment.user_id,
      course_id: enrollment.course_id,
      type: enrollment.type,
      created_at: '2026-08-01T16:00:00Z',
      updated_at: '2026-08-01T16:00:00Z',
      associated_user_id: null,
      start_at: null,
      end_at: null,
      course_section_id: enrollment.course_section_id,
      root_account_id: 1,
      limit_privileges_to_course_section: false,
      enrollment_state: enrollment.enrollment_state,
      role: enrollment.type,
      role_id: ROLE_IDS[enrollment.type] || 3,
      last_activity_at: null,
      last_attended_at: null,
      total_activity_time: 0,
      sis_import_id: null,
      html_url: `${FAKE_CANVAS.ORIGIN}/courses/${enrollment.course_id}/users/${enrollment.user_id}`,
    };
  }

  // One row of GET /courses/:id/enrollments: the enrollment, its SIS ids (for
  // a caller who may read SIS data), student grades, and the embedded user.
  function courseEnrollmentJson(enrollment) {
    const user = userById(enrollment.user_id);
    const json = enrollmentJson(enrollment);
    if (state.readSis) {
      json.sis_account_id = null;
      json.sis_course_id = null;
      json.course_integration_id = null;
      json.sis_section_id = null;
      json.section_integration_id = null;
      json.sis_user_id = user?.sis_user_id ?? null;
    }
    if (enrollment.type === 'StudentEnrollment') {
      json.grades = {
        html_url: `${FAKE_CANVAS.ORIGIN}/courses/${enrollment.course_id}/grades/${enrollment.user_id}`,
        current_grade: null,
        current_score: null,
        final_grade: null,
        final_score: null,
      };
    }
    json.user = user ? userJson(user) : null;
    return json;
  }

  // The user Canvas embeds in an enrollment (lib/api/v1/user.rb user_json):
  // SIS ids and login only for a caller who may read SIS data.
  function userJson(user) {
    const json = {
      id: user.id,
      name: user.name,
      created_at: user.created_at,
      sortable_name: user.sortable_name,
      short_name: user.short_name,
    };
    if (state.readSis) {
      json.sis_user_id = user.sis_user_id ?? null;
      json.integration_id = user.integration_id ?? null;
      json.sis_import_id = null;
      json.login_id = user.login_id ?? null;
    }
    return json;
  }

  function courseJson(course, viewerEnrollments) {
    return {
      id: course.id,
      name: course.name,
      account_id: 1,
      uuid: `e2e-course-${course.id}`,
      start_at: null,
      grading_standard_id: null,
      is_public: false,
      created_at: course.created_at,
      course_code: course.course_code,
      default_view: 'modules',
      root_account_id: 1,
      enrollment_term_id: 1,
      license: 'private',
      grade_passback_setting: null,
      end_at: null,
      public_syllabus: false,
      public_syllabus_to_auth: false,
      storage_quota_mb: 500,
      is_public_to_auth_users: false,
      homeroom_course: false,
      course_color: null,
      friendly_name: null,
      apply_assignment_group_weights: false,
      time_zone: 'America/Vancouver',
      blueprint: false,
      template: false,
      sis_course_id: null,
      integration_id: null,
      enrollments: viewerEnrollments.map((e) => ({
        type: COURSE_ENROLLMENT_TYPE[e.type] || 'student',
        role: e.type,
        role_id: ROLE_IDS[e.type] || 3,
        user_id: e.user_id,
        enrollment_state: e.enrollment_state,
        limit_privileges_to_course_section: false,
      })),
      hide_final_grades: false,
      workflow_state: 'available',
      restrict_enrollments_to_course_dates: false,
    };
  }

  function sectionJson(section) {
    return {
      id: section.id,
      course_id: section.course_id,
      name: section.name,
      start_at: null,
      end_at: null,
      created_at: section.created_at,
      restrict_enrollments_to_section_dates: null,
      nonxlist_course_id: null,
      sis_section_id: null,
      sis_course_id: null,
      integration_id: null,
      sis_import_id: null,
    };
  }

  // Serve one page of `rows`, with the Link header Canvas sends.
  function sendPage(req, res, url, rows) {
    const requested = Number(url.searchParams.get('per_page')) || DEFAULT_PER_PAGE;
    const perPage = Math.max(1, Math.min(requested, state.maxPerPage));
    const lastPage = Math.max(1, Math.ceil(rows.length / perPage));
    const page = Math.max(1, Number(url.searchParams.get('page')) || 1);

    const origin = `http://${req.headers.host || `${FAKE_CANVAS.HOST}:${FAKE_CANVAS.PORT}`}`;
    const pageUrl = (n) => {
      const link = new URL(url.pathname + url.search, origin);
      link.searchParams.set('page', String(n));
      link.searchParams.set('per_page', String(perPage));
      return link.href;
    };
    const links = [`<${pageUrl(page)}>; rel="current"`];
    if (page < lastPage) links.push(`<${pageUrl(page + 1)}>; rel="next"`);
    if (page > 1) links.push(`<${pageUrl(page - 1)}>; rel="prev"`);
    links.push(`<${pageUrl(1)}>; rel="first"`, `<${pageUrl(lastPage)}>; rel="last"`);

    sendJson(res, 200, rows.slice((page - 1) * perPage, page * perPage), {
      Link: links.join(','),
    });
  }

  const unauthorized = (res) =>
    sendJson(
      res,
      401,
      { status: 'unauthorized', errors: [{ message: 'user not authorized to perform that action' }] },
      { 'WWW-Authenticate': 'Bearer realm="canvas-lms"' }
    );
  const notFound = (res) =>
    sendJson(res, 404, { errors: [{ message: 'The specified resource does not exist.' }] });

  function listCourses(req, res, url, userId) {
    const type = ENROLLMENT_TYPES[url.searchParams.get('enrollment_type')] || null;
    const courses = state.courses
      .map((course) => ({
        course,
        mine: state.enrollments.filter(
          (e) =>
            String(e.user_id) === String(userId) &&
            String(e.course_id) === String(course.id) &&
            ROSTER_STATES.includes(e.enrollment_state) &&
            (!type || e.type === type)
        ),
      }))
      .filter(({ mine }) => mine.length > 0)
      .map(({ course, mine }) => courseJson(course, mine));
    sendPage(req, res, url, courses);
  }

  function listSections(req, res, url, userId, courseId) {
    if (!courseById(courseId)) return notFound(res);
    if (!teaches(userId, courseId)) return unauthorized(res);
    const sections = state.sections
      .filter((section) => String(section.course_id) === String(courseId))
      .map(sectionJson);
    sendPage(req, res, url, sections);
  }

  function listCourseEnrollments(req, res, url, userId, courseId) {
    if (!courseById(courseId)) return notFound(res);
    if (!teaches(userId, courseId)) return unauthorized(res);

    const typeParams = listParam(url.searchParams, 'type');
    const types = typeParams.length > 0 ? new Set(typeParams) : null;
    const stateParams = listParam(url.searchParams, 'state');
    const states = new Set(stateParams.length > 0 ? stateParams : ROSTER_STATES);
    const sectionParams = listParam(url.searchParams, 'section_ids');
    const sectionIds = sectionParams.length > 0 ? new Set(sectionParams.map(String)) : null;

    const enrollments = state.enrollments
      .filter(
        (e) =>
          String(e.course_id) === String(courseId) &&
          (!types || types.has(e.type)) &&
          states.has(e.enrollment_state) &&
          (!sectionIds || sectionIds.has(String(e.course_section_id)))
      )
      // Canvas orders a course's enrollments by type, then the user's
      // sortable name, then id.
      .sort((a, b) =>
        a.type.localeCompare(b.type) ||
        String(userById(a.user_id)?.sortable_name || '').localeCompare(
          String(userById(b.user_id)?.sortable_name || '')
        ) ||
        a.id - b.id
      )
      .map(courseEnrollmentJson);
    sendPage(req, res, url, enrollments);
  }

  // Canvas's scope check for a scoped developer key: the request must match
  // one of the token's URL scopes for its method.
  function withinScopes(method, pathname) {
    return state.scopes.some((scope) => {
      const compiled = compileScope(scope);
      return !!compiled && compiled.method === method && compiled.regex.test(pathname);
    });
  }

  async function handleControl(req, res, url) {
    const path = url.pathname.replace(/^\/__e2e/, '');

    if (req.method === 'GET' && path === '/health') {
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === 'POST' && path === '/reset') {
      state = defaultCanvasFixtures();
      requests = [];
      return sendJson(res, 200, { ok: true });
    }
    if (path === '/requests' && req.method === 'GET') {
      return sendJson(res, 200, { requests });
    }
    if (path === '/requests' && req.method === 'DELETE') {
      requests = [];
      return sendJson(res, 200, { ok: true });
    }
    // Simulate a developer key with Enforce Scopes: `scopes` is the list the
    // token was granted; null = a key without Enforce Scopes (the default).
    if (req.method === 'PUT' && path === '/scopes') {
      const body = await readJsonBody(req);
      const scopes = body.scopes;
      if (
        scopes !== null &&
        !(Array.isArray(scopes) && scopes.every((scope) => compileScope(scope)))
      ) {
        return sendJson(res, 400, { error: 'scopes must be null or a list of url:METHOD|/api/v1/… scopes' });
      }
      state.scopes = scopes === null ? null : [...scopes];
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === 'PUT' && path === '/permissions') {
      const body = await readJsonBody(req);
      if (typeof body.readSis !== 'boolean') {
        return sendJson(res, 400, { error: 'readSis must be a boolean' });
      }
      state.readSis = body.readSis;
      return sendJson(res, 200, { ok: true });
    }

    // Replace the active/invited student enrollments of one section. A user
    // who was already enrolled there keeps their state; anyone new is active.
    // Concluded enrollments are left alone.
    const sectionMatch = path.match(/^\/sections\/([^/]+)\/students$/);
    if (req.method === 'PUT' && sectionMatch) {
      const section = state.sections.find((s) => String(s.id) === sectionMatch[1]);
      if (!section) return sendJson(res, 404, { error: 'Unknown section' });
      const body = await readJsonBody(req);
      const userIds = Array.isArray(body.userIds) ? body.userIds.map(String) : null;
      if (!userIds || userIds.some((id) => !userById(id))) {
        return sendJson(res, 400, { error: 'userIds must list known fake Canvas user ids' });
      }

      const isRosterRow = (e) =>
        String(e.course_section_id) === String(section.id) &&
        e.type === 'StudentEnrollment' &&
        ROSTER_STATES.includes(e.enrollment_state);
      const previous = new Map(
        state.enrollments.filter(isRosterRow).map((e) => [String(e.user_id), e])
      );
      let nextId = Math.max(0, ...state.enrollments.map((e) => e.id)) + 1;
      state.enrollments = [
        ...state.enrollments.filter((e) => !isRosterRow(e)),
        ...userIds.map((id) =>
          previous.get(id) || {
            id: nextId++,
            user_id: Number(id),
            course_id: section.course_id,
            course_section_id: section.id,
            type: 'StudentEnrollment',
            enrollment_state: 'active',
          }
        ),
      ];
      return sendJson(res, 200, { ok: true });
    }

    return sendJson(res, 404, { error: 'Unknown fake Canvas control route' });
  }

  async function handle(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (url.pathname.startsWith('/__e2e/')) return handleControl(req, res, url);

    const authorization = String(req.headers.authorization || '');
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    const userId = state.tokens[token] || null;
    const record = {
      method: req.method,
      path: url.pathname,
      // As GRASP sent it, before any scoped-key include stripping.
      query: [...url.searchParams.entries()],
      authorized: !!userId,
      scopesEnforced: Array.isArray(state.scopes),
      status: null,
    };
    requests.push(record);
    res.on('finish', () => {
      record.status = res.statusCode;
    });

    // The toolkit refreshes a token that is expired or rejected. The seeded
    // token never expires, so a refresh here means something is wrong: refuse
    // it like Canvas refuses a revoked grant.
    if (req.method === 'POST' && url.pathname === '/login/oauth2/token') {
      return sendJson(res, 400, {
        error: 'invalid_grant',
        error_description: 'The fake Canvas does not issue or refresh tokens.',
      });
    }

    if (!url.pathname.startsWith('/api/v1/')) return notFound(res);
    if (!userId) {
      return sendJson(
        res,
        401,
        { errors: [{ message: 'Invalid access token.' }] },
        { 'WWW-Authenticate': 'Bearer realm="canvas-lms"' }
      );
    }
    if (Array.isArray(state.scopes)) {
      // Canvas answers an out-of-scope call with 401 but, unlike an invalid
      // token, without WWW-Authenticate.
      if (!withinScopes(req.method, url.pathname)) {
        return sendJson(res, 401, { errors: [{ message: 'Insufficient scopes on access token.' }] });
      }
      stripIncludes(url.searchParams);
    }
    if (req.method !== 'GET') return notFound(res);

    if (url.pathname === '/api/v1/courses') return listCourses(req, res, url, userId);
    const sections = url.pathname.match(/^\/api\/v1\/courses\/([^/]+)\/sections$/);
    if (sections) return listSections(req, res, url, userId, decodeURIComponent(sections[1]));
    const enrollments = url.pathname.match(/^\/api\/v1\/courses\/([^/]+)\/enrollments$/);
    if (enrollments) {
      return listCourseEnrollments(req, res, url, userId, decodeURIComponent(enrollments[1]));
    }
    return notFound(res);
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((error) => {
      if (!res.headersSent) sendJson(res, 400, { error: error.message });
      else res.end();
    });
  });

  return {
    server,
    listen(port = FAKE_CANVAS.PORT, host = FAKE_CANVAS.HOST) {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.off('error', reject);
          resolve(server.address());
        });
      });
    },
    close() {
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

module.exports = { createFakeCanvas };
