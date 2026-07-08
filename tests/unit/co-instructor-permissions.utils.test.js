jest.mock('../../src/utils/auth', () => ({
  isAppAdministrator: jest.fn(),
}));

jest.mock('../../src/services/course', () => ({
  getCourseById: jest.fn(),
}));

jest.mock('../../src/services/settings', () => ({
  getSettings: jest.fn(),
}));

const { isAppAdministrator } = require('../../src/utils/auth');
const { getCourseById } = require('../../src/services/course');
const settingsService = require('../../src/services/settings');
const {
  PERMISSION_KEYS,
  assertCoInstructorPermission,
  hasCoInstructorPermission,
  isCourseManager,
} = require('../../src/utils/co-instructor-permissions');

describe('co-instructor permission utilities', () => {
  beforeEach(() => {
    isAppAdministrator.mockResolvedValue(false);
    getCourseById.mockResolvedValue({ _id: 'course-1', owner: 'owner-1' });
    settingsService.getSettings.mockResolvedValue({});
  });

  it('denies missing users or missing course IDs before loading course settings', async () => {
    await expect(
      hasCoInstructorPermission(null, 'course-1', PERMISSION_KEYS.CREATE_QUIZ)
    ).resolves.toBe(false);
    await expect(
      hasCoInstructorPermission({ _id: 'user-1' }, '', PERMISSION_KEYS.CREATE_QUIZ)
    ).resolves.toBe(false);

    expect(getCourseById).not.toHaveBeenCalled();
    expect(settingsService.getSettings).not.toHaveBeenCalled();
  });

  it('allows app administrators and course owners regardless of settings', async () => {
    isAppAdministrator.mockResolvedValueOnce(true);

    await expect(
      hasCoInstructorPermission(
        { _id: 'admin-1' },
        'course-1',
        PERMISSION_KEYS.COURSE_MATERIALS
      )
    ).resolves.toBe(true);
    expect(getCourseById).not.toHaveBeenCalled();

    settingsService.getSettings.mockResolvedValueOnce({
      coInstructorPermissions: { [PERMISSION_KEYS.COURSE_MATERIALS]: false },
    });

    await expect(
      hasCoInstructorPermission(
        { _id: 'owner-1' },
        'course-1',
        PERMISSION_KEYS.COURSE_MATERIALS
      )
    ).resolves.toBe(true);
  });

  it('allows co-instructors by default and denies only explicitly disabled permissions', async () => {
    await expect(
      hasCoInstructorPermission(
        { _id: 'co-instructor-1' },
        'course-1',
        PERMISSION_KEYS.QUESTION_BANK
      )
    ).resolves.toBe(true);

    settingsService.getSettings.mockResolvedValueOnce({
      coInstructorPermissions: { [PERMISSION_KEYS.QUESTION_BANK]: false },
    });

    await expect(
      hasCoInstructorPermission(
        { _id: 'co-instructor-1' },
        'course-1',
        PERMISSION_KEYS.QUESTION_BANK
      )
    ).resolves.toBe(false);
  });

  it('recognizes only app administrators and owners as course managers', async () => {
    await expect(isCourseManager({ _id: 'owner-1' }, 'course-1')).resolves.toBe(true);
    await expect(isCourseManager({ _id: 'co-instructor-1' }, 'course-1')).resolves.toBe(
      false
    );
  });

  it('writes the expected 403 response when the express guard denies access', async () => {
    settingsService.getSettings.mockResolvedValueOnce({
      coInstructorPermissions: { [PERMISSION_KEYS.SETTINGS]: false },
    });
    const status = jest.fn().mockReturnThis();
    const json = jest.fn();

    await expect(
      assertCoInstructorPermission(
        { user: { _id: 'co-instructor-1' } },
        { status, json },
        'course-1',
        PERMISSION_KEYS.SETTINGS
      )
    ).resolves.toBe(false);

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({
      error: "You don't have permission to perform this action in this course.",
    });
  });

  it('returns true without writing a response when the express guard allows access', async () => {
    const status = jest.fn().mockReturnThis();
    const json = jest.fn();

    await expect(
      assertCoInstructorPermission(
        { user: { _id: 'owner-1' } },
        { status, json },
        'course-1',
        PERMISSION_KEYS.CREATE_QUIZ
      )
    ).resolves.toBe(true);

    expect(status).not.toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
  });
});
