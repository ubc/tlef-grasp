// One LMS identity (a Canvas user id, a Moodle user id) only means something
// together with the deployment it came from: Canvas user 42 on ubc.instructure.com
// and Canvas user 42 on a test instance are different people. Everything GRASP
// stores about an LMS — section links, synced accounts — carries that deployment
// as an `instance`, written through this one normalizer so the same deployment
// always compares equal however its *_DOMAIN variable was spelled.

const DOMAIN_ENV_VARS = {
  canvas: 'CANVAS_DOMAIN',
  moodle: 'MOODLE_DOMAIN',
};

/**
 * Normalize an LMS domain to its origin: lower-case scheme + host (+ port when
 * it is not the scheme's default), no path and no trailing slash. A bare domain
 * is taken as HTTPS, matching how the LMS toolkit resolves it.
 *
 *   'ubc.instructure.com'           -> 'https://ubc.instructure.com'
 *   'HTTP://LocalHost:9100/'        -> 'http://localhost:9100'
 *   'https://canvas.example/login'  -> 'https://canvas.example'
 *
 * @param {string} domain
 * @returns {string|null} The origin, or null when the value is empty or unparseable
 */
function normalizeLmsInstance(domain) {
  const trimmed = typeof domain === 'string' ? domain.trim() : '';
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (!url.host) return null;
    return `${url.protocol}//${url.host}`.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * The normalized instance this deployment is configured for, per provider.
 * @param {'canvas'|'moodle'} provider
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string|null}
 */
function currentLmsInstance(provider, env = process.env) {
  const name = DOMAIN_ENV_VARS[provider];
  return name ? normalizeLmsInstance(env[name]) : null;
}

module.exports = {
  normalizeLmsInstance,
  currentLmsInstance,
};
