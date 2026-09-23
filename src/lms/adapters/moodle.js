const { LmsRosterError, ROSTER_ERROR_CODES } = require('../roster-errors');

/**
 * Moodle roster sync is out of scope: Moodle-linked sections keep syncing
 * students from the UBC Academic API. Present so the adapter seam has the same
 * shape for every provider.
 */
async function getSectionRoster() {
  throw new LmsRosterError(
    ROSTER_ERROR_CODES.UNSUPPORTED,
    'Syncing students from Moodle is not supported.'
  );
}

module.exports = {
  getSectionRoster,
};
