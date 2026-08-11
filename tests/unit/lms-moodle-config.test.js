const {
  REQUIRED_MOODLE_ENV_VARS,
  isMoodleConfigured,
} = require('../../src/lms/moodle');

describe('Moodle integration environment gating', () => {
  it('is enabled only when MOODLE_DOMAIN is non-empty', () => {
    expect(REQUIRED_MOODLE_ENV_VARS).toEqual(['MOODLE_DOMAIN']);
    expect(isMoodleConfigured({ MOODLE_DOMAIN: 'moodle.example.test' })).toBe(true);
    expect(isMoodleConfigured({ MOODLE_DOMAIN: '  ' })).toBe(false);
    expect(isMoodleConfigured({})).toBe(false);
  });
});
