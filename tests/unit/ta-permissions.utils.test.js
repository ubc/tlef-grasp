// Per-TA capability resolution (utils/ta-permissions.js): faculty and
// non-TA memberships are never restricted; TAs default to full access
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
  getEffectiveTaPermissions,
  sanitizeTaPermissions,
  hasTaPermission,
  assertTaPermission,
} = require('../../src/utils/ta-permissions');

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
  it('defaults every key to true when no map is stored (grandfathered access)', () => {
    const effective = getEffectiveTaPermissions(null);
    for (const key of ALL_TA_PERMISSION_KEYS) {
      expect(effective[key]).toBe(true);
    }
  });

  it('keeps explicit false values and fills in missing keys as true', () => {
    const effective = getEffectiveTaPermissions({ questionBank: false });
    expect(effective.questionBank).toBe(false);
    expect(effective.questionFlags).toBe(true);
    expect(effective.dashboard).toBe(true);
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
  it('always allows faculty without a membership lookup', async () => {
    await expect(
      hasTaPermission(faculty, COURSE_ID, TA_PERMISSION_KEYS.QUESTION_BANK)
    ).resolves.toBe(true);
    expect(getUserCourseMembership).not.toHaveBeenCalled();
  });

  it('never restricts a non-TA membership (genuine SAML staff)', async () => {
    getUserCourseMembership.mockResolvedValue({ userId: 'staff-1', courseId: COURSE_ID });
    await expect(
      hasTaPermission(samlStaff, COURSE_ID, TA_PERMISSION_KEYS.QUESTION_BANK)
    ).resolves.toBe(true);
  });

  it('allows a TA whose map does not mention the key (default allow)', async () => {
    getUserCourseMembership.mockResolvedValue({ courseRole: 'ta' });
    await expect(
      hasTaPermission(taUser, COURSE_ID, TA_PERMISSION_KEYS.QUESTION_FLAGS)
    ).resolves.toBe(true);
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
      assertTaPermission({ user: taUser }, res, COURSE_ID, TA_PERMISSION_KEYS.USERS)
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
