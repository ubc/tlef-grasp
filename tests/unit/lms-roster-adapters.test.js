// The LMS adapter seam for roster sync (issue #113). The Canvas adapter is
// driven with a fake paging API client (the toolkit's `getAll(path, query)`), so
// these tests see exactly what GRASP asks Canvas for and how a raw Canvas
// enrollments response becomes the roster of ONE linked section.
const { canvas } = require('@ubc/ubc-genai-toolkit-lms-integration');
const { getLmsAdapter } = require('../../src/lms/adapters');
const canvasAdapter = require('../../src/lms/adapters/canvas');
const moodleAdapter = require('../../src/lms/adapters/moodle');
const { LmsRosterError } = require('../../src/lms/roster-errors');
const { normalizeLmsInstance, currentLmsInstance } = require('../../src/lms/instance');

const LINK = { externalCourseId: '42', externalSectionId: '501' };

// A Canvas user as embedded in an enrollment by GET /courses/:id/enrollments
// (SIS fields present, as for a token allowed to read SIS data).
function canvasUser(id, name, extra = {}) {
  return {
    id,
    name,
    created_at: '2026-08-01T16:00:00Z',
    sortable_name: `${name.split(' ')[1]}, ${name.split(' ')[0]}`,
    short_name: name,
    sis_user_id: `SIS${id}`,
    integration_id: `PUID${id}`,
    login_id: `user${id}`,
    ...extra,
  };
}

// A Canvas enrollment of `user` in `sectionId`, with the user embedded.
function enrollment(user, sectionId, extra = {}) {
  return {
    id: Number(`9${user.id}${sectionId}`),
    user_id: user.id,
    course_id: 42,
    course_section_id: sectionId,
    type: 'StudentEnrollment',
    enrollment_state: 'active',
    user,
    ...extra,
  };
}

// The toolkit's paging client: getAll(path, query) resolves every page.
function fakeClient(enrollments) {
  return { getAll: jest.fn().mockResolvedValue(enrollments) };
}

async function readRoster(enrollments) {
  const client = fakeClient(enrollments);
  const result = await canvasAdapter.getSectionRoster({ client, link: LINK });
  return { client, ...result };
}

describe('Canvas roster adapter', () => {
  it('reads the course student enrollments (active + invited) with no include parameters', async () => {
    const { client } = await readRoster([]);

    expect(client.getAll).toHaveBeenCalledTimes(1);
    const [path, query] = client.getAll.mock.calls[0];
    expect(path).toBe('/courses/42/enrollments');
    // A scoped Canvas developer key strips include[] (other than uuid), so the
    // roster read must not depend on any.
    expect(query).toEqual({ type: ['StudentEnrollment'], state: ['active', 'invited'] });
  });

  it('encodes the Canvas course id into the path', async () => {
    const client = fakeClient([]);
    await canvasAdapter.getSectionRoster({
      client,
      link: { externalCourseId: 'sis_course_id:BIOC/302', externalSectionId: '1' },
    });

    expect(client.getAll.mock.calls[0][0]).toBe('/courses/sis_course_id%3ABIOC%2F302/enrollments');
  });

  it('keeps only students enrolled in the linked Canvas section', async () => {
    const both = canvasUser(3, 'Cy Both');
    const { roster } = await readRoster([
      enrollment(canvasUser(1, 'Ann Linked'), 501),
      enrollment(canvasUser(2, 'Ben Othersection'), 502),
      // Enrolled in two sections of the course, one of them the linked one
      // (section ids compare as strings).
      enrollment(both, 502),
      enrollment(both, '501'),
    ]);

    expect(roster.map((row) => row.name)).toEqual(['Ann Linked', 'Cy Both']);
  });

  it('excludes the Test Student, TAs, teachers, designers, and observers in the section', async () => {
    const { roster } = await readRoster([
      enrollment(canvasUser(1, 'Ann Student'), 501),
      enrollment(canvasUser(2, 'Test Student'), 501, { type: 'StudentViewEnrollment' }),
      enrollment(canvasUser(3, 'Tia Assistant'), 501, { type: 'TaEnrollment' }),
      enrollment(canvasUser(4, 'Tom Teacher'), 501, { type: 'TeacherEnrollment' }),
      enrollment(canvasUser(5, 'Dee Designer'), 501, { type: 'DesignerEnrollment' }),
      enrollment(canvasUser(6, 'Obi Observer'), 501, { type: 'ObserverEnrollment' }),
    ]);

    expect(roster.map((row) => row.name)).toEqual(['Ann Student']);
  });

  it('keeps active and invited students and excludes concluded, inactive, and deleted ones', async () => {
    const { roster } = await readRoster([
      enrollment(canvasUser(1, 'Ann Active'), 501),
      enrollment(canvasUser(2, 'Ivan Invited'), 501, { enrollment_state: 'invited' }),
      enrollment(canvasUser(3, 'Cora Completed'), 501, { enrollment_state: 'completed' }),
      enrollment(canvasUser(4, 'Ian Inactive'), 501, { enrollment_state: 'inactive' }),
      enrollment(canvasUser(5, 'Del Deleted'), 501, { enrollment_state: 'deleted' }),
      enrollment(canvasUser(6, 'Rae Rejected'), 501, { enrollment_state: 'rejected' }),
    ]);

    expect(roster.map((row) => row.name)).toEqual(['Ann Active', 'Ivan Invited']);
  });

  it('ignores a TA enrollment in the linked section when the student enrollment is elsewhere', async () => {
    const tia = canvasUser(1, 'Tia Split');
    const { roster } = await readRoster([
      enrollment(tia, 501, { type: 'TaEnrollment' }),
      enrollment(tia, 502),
    ]);

    expect(roster).toEqual([]);
  });

  it('lists a student with two enrollments in the section once', async () => {
    const ann = canvasUser(1, 'Ann Twice');
    const { roster, coverage } = await readRoster([
      enrollment(ann, 501),
      enrollment(ann, 501, { id: 77, enrollment_state: 'invited' }),
      enrollment(canvasUser(2, 'Ben Once'), 501),
    ]);

    expect(roster.map((row) => row.externalUserId)).toEqual(['1', '2']);
    expect(coverage).toEqual({ total: 2, integrationId: 2 });
  });

  it('maps each section student to the provider-neutral roster row', async () => {
    const { roster } = await readRoster([
      enrollment(canvasUser(7, 'Ann Linked'), 501),
    ]);

    expect(roster).toEqual([{
      externalUserId: '7',
      integrationId: 'PUID7',
      sisUserId: 'SIS7',
      loginId: 'user7',
      name: 'Ann Linked',
      sortableName: 'Linked, Ann',
    }]);
  });

  it('trims the user fields, drops empty ones, and falls back where Canvas allows', async () => {
    const user = canvasUser(8, 'Bo Blank', {
      name: '  ',
      sortable_name: '  Blank, Bo ',
      integration_id: ' PUID8 ',
      sis_user_id: '',
      login_id: null,
    });
    const { roster } = await readRoster([
      // user_id missing on the enrollment: the embedded user's id is used.
      enrollment(user, 501, { user_id: undefined, sis_user_id: ' ENRSIS8 ' }),
    ]);

    expect(roster).toEqual([{
      externalUserId: '8',
      integrationId: 'PUID8',
      sisUserId: 'ENRSIS8',
      loginId: undefined,
      name: 'Blank, Bo',
      sortableName: 'Blank, Bo',
    }]);
  });

  it('leaves the SIS fields out when Canvas withholds them (no SIS permission)', async () => {
    const { roster, coverage } = await readRoster([
      enrollment({ id: 9, name: 'No Sis', sortable_name: 'Sis, No' }, 501),
    ]);

    expect(roster).toEqual([{
      externalUserId: '9',
      integrationId: undefined,
      sisUserId: undefined,
      loginId: undefined,
      name: 'No Sis',
      sortableName: 'Sis, No',
    }]);
    expect(coverage).toEqual({ total: 1, integrationId: 0 });
  });

  it('reports integration_id coverage of the section roster only', async () => {
    const { coverage } = await readRoster([
      enrollment(canvasUser(1, 'Ann Linked'), 501),
      enrollment(canvasUser(2, 'Ben Linked', { integration_id: null }), 501),
      enrollment(canvasUser(3, 'Cy Linked', { integration_id: '  ' }), 501),
      // Not in the section: must not count toward coverage.
      enrollment(canvasUser(4, 'Dan Other', { integration_id: null }), 502),
    ]);

    expect(coverage).toEqual({ total: 3, integrationId: 1 });
  });

  it.each([
    ['none of them carries', (e) => ({ ...e, course_section_id: undefined })],
    ['one of them lacks', (e, i) => (i === 1 ? { ...e, course_section_id: null } : e)],
  ])('refuses enrollments whose section is unknown (%s course_section_id) instead of reading an empty section', async (_label, strip) => {
    const enrollments = [
      enrollment(canvasUser(1, 'Ann Student'), 501),
      enrollment(canvasUser(2, 'Ben Student'), 501),
    ].map(strip);

    const error = await readRoster(enrollments).catch((e) => e);

    expect(error).toBeInstanceOf(LmsRosterError);
    expect(error.code).toBe('section-scope-unavailable');
  });

  it('returns an empty roster, not an error, when the course has no students at all', async () => {
    const { roster, coverage } = await readRoster([]);

    expect(roster).toEqual([]);
    expect(coverage).toEqual({ total: 0, integrationId: 0 });
  });

  it('returns an empty roster when the course has students but none in the linked section', async () => {
    const { roster } = await readRoster([enrollment(canvasUser(1, 'Ann Other'), 502)]);

    expect(roster).toEqual([]);
  });

  it('propagates a Canvas API failure rather than returning an empty roster', async () => {
    const client = { getAll: jest.fn().mockRejectedValue(new canvas.CanvasApiError('boom', 401)) };

    await expect(canvasAdapter.getSectionRoster({ client, link: LINK }))
      .rejects.toBeInstanceOf(canvas.CanvasApiError);
  });
});

describe('Moodle roster adapter', () => {
  it('refuses with a typed unsupported error (Moodle sections sync from the Academic API)', async () => {
    const error = await moodleAdapter.getSectionRoster({ link: LINK }).catch((e) => e);

    expect(error).toBeInstanceOf(LmsRosterError);
    expect(error.code).toBe('unsupported');
  });
});

describe('getLmsAdapter', () => {
  it('returns the adapter for each supported provider and null otherwise', () => {
    expect(getLmsAdapter('canvas')).toBe(canvasAdapter);
    expect(getLmsAdapter('moodle')).toBe(moodleAdapter);
    expect(getLmsAdapter('blackboard')).toBeNull();
    expect(getLmsAdapter('toString')).toBeNull();
    expect(getLmsAdapter(undefined)).toBeNull();
  });
});

describe('LMS instance normalizer', () => {
  it.each([
    ['ubc.instructure.com', 'https://ubc.instructure.com'],
    ['https://ubc.instructure.com/', 'https://ubc.instructure.com'],
    ['HTTP://LocalHost:9100/', 'http://localhost:9100'],
    ['https://canvas.example/login/oauth2', 'https://canvas.example'],
    ['https://canvas.example:443', 'https://canvas.example'],
    ['  https://Canvas.Example  ', 'https://canvas.example'],
  ])('normalizes %p to %p', (input, expected) => {
    expect(normalizeLmsInstance(input)).toBe(expected);
  });

  it.each([[''], ['   '], [undefined], [null], ['http://']])('returns null for %p', (input) => {
    expect(normalizeLmsInstance(input)).toBeNull();
  });

  it('reads the configured domain per provider, so spelling variants compare equal', () => {
    const env = { CANVAS_DOMAIN: 'Canvas.Example.test/', MOODLE_DOMAIN: 'http://moodle.test:9200' };

    expect(currentLmsInstance('canvas', env)).toBe('https://canvas.example.test');
    expect(currentLmsInstance('canvas', env)).toBe(normalizeLmsInstance('https://canvas.example.test'));
    expect(currentLmsInstance('moodle', env)).toBe('http://moodle.test:9200');
    expect(currentLmsInstance('other', env)).toBeNull();
    expect(currentLmsInstance('canvas', {})).toBeNull();
  });
});
