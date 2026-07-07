jest.mock('../../src/services/database', () => ({
  connect: jest.fn(),
}));

const {
  ROLES,
  getUserRole,
  hasMinimumRole,
  isAppAdministrator,
  parseAffiliations,
} = require('../../src/utils/auth');

describe('auth utilities', () => {
  const originalAdministrator = process.env.APP_ADMINISTRATOR;

  afterEach(() => {
    if (originalAdministrator === undefined) {
      delete process.env.APP_ADMINISTRATOR;
    } else {
      process.env.APP_ADMINISTRATOR = originalAdministrator;
    }
  });

  describe('parseAffiliations', () => {
    it('normalizes comma-delimited and array affiliations', () => {
      expect(parseAffiliations({ affiliation: 'student, staff,affiliate' })).toEqual([
        'student',
        'staff',
        'affiliate',
      ]);
      expect(parseAffiliations({ affiliation: ['faculty', 'staff'] })).toEqual([
        'faculty',
        'staff',
      ]);
    });

    it('returns an empty list for missing users or affiliations', () => {
      expect(parseAffiliations(null)).toEqual([]);
      expect(parseAffiliations({})).toEqual([]);
    });
  });

  describe('getUserRole', () => {
    it('uses faculty precedence over staff and student affiliations', async () => {
      await expect(
        getUserRole({ puid: 'regular-user', affiliation: 'student,staff,faculty' })
      ).resolves.toBe(ROLES.FACULTY);
    });

    it('treats whitelisted application administrators as faculty', async () => {
      process.env.APP_ADMINISTRATOR = 'admin-one, admin-two';

      await expect(
        getUserRole({ puid: 'admin-two', affiliation: 'staff' })
      ).resolves.toBe(ROLES.FACULTY);
      await expect(
        isAppAdministrator({ puid: 'admin-two', affiliation: 'staff' })
      ).resolves.toBe(true);
    });

    it('defaults unknown or affiliate-only users to the student role', async () => {
      await expect(getUserRole({ puid: 'guest', affiliation: 'affiliate' })).resolves.toBe(
        ROLES.STUDENT
      );
      await expect(getUserRole({ puid: 'unknown', affiliation: 'alumni' })).resolves.toBe(
        ROLES.STUDENT
      );
    });
  });

  describe('hasMinimumRole', () => {
    it('allows higher roles to satisfy lower requirements', async () => {
      await expect(
        hasMinimumRole({ puid: 'faculty-user', affiliation: 'faculty' }, ROLES.STAFF)
      ).resolves.toBe(true);
      await expect(
        hasMinimumRole({ puid: 'staff-user', affiliation: 'staff' }, ROLES.FACULTY)
      ).resolves.toBe(false);
    });
  });
});
