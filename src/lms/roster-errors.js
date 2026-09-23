// Typed failures of an LMS roster read or sync. Each one means "nothing was
// applied": the route maps the code to a clear 4xx/5xx instead of letting a
// roster GRASP could not trust be read as an empty section, which would drop
// every student in it.

const ROSTER_ERROR_CODES = {
  // The LMS returned enrollments without their section, so they cannot be
  // attributed to the linked section.
  SECTION_SCOPE_UNAVAILABLE: 'section-scope-unavailable',
  // Roster sync is not implemented for this provider.
  UNSUPPORTED: 'unsupported',
  // The section roster is non-empty but not one row carries an
  // integration_id (the UBC PUID), so no student can be matched.
  NO_INTEGRATION_IDS: 'no-integration-ids',
};

class LmsRosterError extends Error {
  /**
   * @param {string} code - One of ROSTER_ERROR_CODES
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = 'LmsRosterError';
    this.code = code;
  }
}

module.exports = {
  LmsRosterError,
  ROSTER_ERROR_CODES,
};
