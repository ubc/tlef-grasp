// Per-TA capability resolution (utils/ta-permissions.js): non-members are
// refused (app administrators excepted); faculty and non-TA memberships are
// never restricted; TAs default to full access
// (grandfathered) with individual keys switchable off; the 'settings' key is
// always denied for TAs regardless of the stored map.

jest.mock('../../src/services/database', () => ({
  connect: jest.fn(),
}));

jest.mock('../../src/services/user-course', () => ({
  getUserCourseMembership: jest.fn(),
}));

const { getUserCourseMembership } = require('../../src/services/user-course');
const {
  TA_PERMISSION_KEYS,
  TA_SETTINGS_KEY,
  ALL_TA_PERMISSION_KEYS,
  TA_GRANTABLE_PERMISSION_KEYS,
  getEffectiveTaPermissions,
  sanitizeTaPermissions,
  hasTaPermission,
  assertTaPermission,
} = require('../../src/utils/ta-permissions');

const { grantTaPage } = require('../fixtures/ta-grant');

const COURSE_ID = 'course-1';
const faculty = { _id: 'prof-1', puid: 'prof-1', affiliation: ['faculty'] };
const samlStaff = { _id: 'staff-1', puid: 'staff-1', affiliation: ['staff'] };
const taUser = {
  _id: 'ta-1',
  puid: 'ta-1',
  affiliation: ['student', 'staff'],
  staffViaTaPromotion: true,
};

afterEach(() => {
  jest.clearAllMocks();
});

describe('getEffectiveTaPermissions', () => {
  it('turns on every grantable page, and only those, when no map is stored', () => {
    const effective = getEffectiveTaPermissions(null);
    for (const key of ALL_TA_PERMISSION_KEYS) {
      expect(effective[key]).toBe(TA_GRANTABLE_PERMISSION_KEYS.includes(key));
    }
  });

  it('keeps explicit false values and fills in missing grantable keys as true', () => {
    const effective = getEffectiveTaPermissions({ questionBank: false });
    expect(effective.questionBank).toBe(false);
    expect(effective.dashboard).toBe(true);
  });

  it('keeps pages TAs cannot be granted off even when the map turns them on', () => {
    const effective = getEffectiveTaPermissions({ quizzes: true, users: true, questionFlags: true });
    expect(effective.quizzes).toBe(false);
    expect(effective.users).toBe(false);
    expect(effective.questionFlags).toBe(false);
  });
});

describe('sanitizeTaPermissions', () => {
  it('accepts a full boolean map of known keys', () => {
    const input = Object.fromEntries(ALL_TA_PERMISSION_KEYS.map((k) => [k, false]));
    expect(sanitizeTaPermissions(input)).toEqual(input);
  });

  it('accepts a partial map', () => {
    expect(sanitizeTaPermissions({ users: false })).toEqual({ users: false });
  });

  it('rejects unknown keys — settings is not configurable', () => {
    expect(sanitizeTaPermissions({ settings: true })).toBeNull();
    expect(sanitizeTaPermissions({ isAdmin: true })).toBeNull();
  });

  it('rejects non-boolean values and non-object payloads', () => {
    expect(sanitizeTaPermissions({ users: 'yes' })).toBeNull();
    expect(sanitizeTaPermissions(null)).toBeNull();
    expect(sanitizeTaPermissions(['users'])).toBeNull();
    expect(sanitizeTaPermissions('users')).toBeNull();
  });
});

describe('hasTaPermission', () => {
  it('allows faculty who are members of the course', async () => {
    getUserCourseMembership.mockResolvedValue({ userId: 'prof-1', courseId: COURSE_ID });
    await expect(
      hasTaPermission(faculty, COURSE_ID, TA_PERMISSION_KEYS.QUESTION_BANK)
    ).resolves.toBe(true);
  });

  // A non-member used to pass (they are not a TA there), which made the check
  // unsafe wherever a handler forgot hasStaffAccessInCourse.
  it.each([
    ['faculty', faculty],
    ['SAML staff', samlStaff],
    ['a promoted TA from another course', taUser],
  ])('refuses %s who are not members of the course', async (_label, user) => {
    getUserCourseMembership.mockResolvedValue(null);
    await expect(
      hasTaPermission(user, COURSE_ID, TA_PERMISSION_KEYS.QUESTION_GENERATION)
    ).resolves.toBe(false);
  });

  it('allows an app administrator in any course', async () => {
    const previous = process.env.APP_ADMINISTRATOR;
    process.env.APP_ADMINISTRATOR = 'admin-1';
    try {
      await expect(
        hasTaPermission({ _id: 'admin-1', puid: 'admin-1' }, COURSE_ID, TA_PERMISSION_KEYS.USERS)
      ).resolves.toBe(true);
      expect(getUserCourseMembership).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.APP_ADMINISTRATOR;
      else process.env.APP_ADMINISTRATOR = previous;
    }
  });

  it('never restricts a non-TA membership (genuine SAML staff)', async () => {
    getUserCourseMembership.mockResolvedValue({ userId: 'staff-1', courseId: COURSE_ID });
    await expect(
      hasTaPermission(samlStaff, COURSE_ID, TA_PERMISSION_KEYS.QUESTION_BANK)
    ).resolves.toBe(true);
  });

  it('allows a TA whose map does not mention a grantable key (default allow)', async () => {
    getUserCourseMembership.mockResolvedValue({ courseRole: 'ta' });
    await expect(
      hasTaPermission(taUser, COURSE_ID, TA_PERMISSION_KEYS.QUESTION_BANK)
    ).resolves.toBe(true);
  });

  // TAs only get Dashboard, Course Materials, Question Generation and the
  // Question Bank; everything else is closed whatever the instructor stored.
  it.each([
    TA_PERMISSION_KEYS.QUIZZES,
    TA_PERMISSION_KEYS.QUIZ_SCORES,
    TA_PERMISSION_KEYS.QUESTION_FLAGS,
    TA_PERMISSION_KEYS.USERS,
    TA_PERMISSION_KEYS.MY_SECTIONS,
  ])('denies a TA the %s page even when their map grants it', async (key) => {
    getUserCourseMembership.mockResolvedValue({ courseRole: 'ta', taPermissions: { [key]: true } });
    await expect(hasTaPermission(taUser, COURSE_ID, key)).resolves.toBe(false);
  });

  it('never restricts SAML staff on pages TAs cannot be granted', async () => {
    getUserCourseMembership.mockResolvedValue({ userId: 'staff-1', courseId: COURSE_ID });
    await expect(
      hasTaPermission(samlStaff, COURSE_ID, TA_PERMISSION_KEYS.QUIZ_SCORES)
    ).resolves.toBe(true);
  });

  it('allows a page once it is added to the grantable list', async () => {
    const release = grantTaPage(TA_PERMISSION_KEYS.QUIZ_SCORES);
    try {
      getUserCourseMembership.mockResolvedValue({ courseRole: 'ta' });
      await expect(
        hasTaPermission(taUser, COURSE_ID, TA_PERMISSION_KEYS.QUIZ_SCORES)
      ).resolves.toBe(true);
    } finally {
      release();
    }
  });

  it('denies a TA whose map switches the key off', async () => {
    getUserCourseMembership.mockResolvedValue({
      courseRole: 'ta',
      taPermissions: { questionBank: false },
    });
    await expect(
      hasTaPermission(taUser, COURSE_ID, TA_PERMISSION_KEYS.QUESTION_BANK)
    ).resolves.toBe(false);
  });

  it('always denies the settings key for TAs, even with no stored map', async () => {
    getUserCourseMembership.mockResolvedValue({ courseRole: 'ta' });
    await expect(hasTaPermission(taUser, COURSE_ID, TA_SETTINGS_KEY)).resolves.toBe(false);
  });

  it('denies when user or course is missing', async () => {
    await expect(hasTaPermission(null, COURSE_ID, 'users')).resolves.toBe(false);
    await expect(hasTaPermission(taUser, null, 'users')).resolves.toBe(false);
  });
});

describe('assertTaPermission', () => {
  function mockRes() {
    return {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
  }

  it('returns true and sends nothing when allowed', async () => {
    getUserCourseMembership.mockResolvedValue({ courseRole: 'ta' });
    const res = mockRes();
    await expect(
      assertTaPermission({ user: taUser }, res, COURSE_ID, TA_PERMISSION_KEYS.DASHBOARD)
    ).resolves.toBe(true);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('sends a 403 and returns false when denied', async () => {
    getUserCourseMembership.mockResolvedValue({
      courseRole: 'ta',
      taPermissions: { users: false },
    });
    const res = mockRes();
    await expect(
      assertTaPermission({ user: taUser }, res, COURSE_ID, TA_PERMISSION_KEYS.USERS)
    ).resolves.toBe(false);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false })
    );
  });
});
