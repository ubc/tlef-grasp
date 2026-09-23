// Per-provider roster readers behind one shape, so the roster sync service
// never needs to know which LMS a section is linked to.
const canvasAdapter = require('./canvas');
const moodleAdapter = require('./moodle');

const ADAPTERS = {
  canvas: canvasAdapter,
  moodle: moodleAdapter,
};

/**
 * @param {string} provider - An lmsLink provider ('canvas' | 'moodle')
 * @returns {{ getSectionRoster: Function }|null} null for an unknown provider
 */
function getLmsAdapter(provider) {
  return Object.prototype.hasOwnProperty.call(ADAPTERS, provider)
    ? ADAPTERS[provider]
    : null;
}

module.exports = { getLmsAdapter };
