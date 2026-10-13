/**
 * Cross-site request forgery (CSRF) protection.
 *
 * Refuses a state-changing request (any method but GET, HEAD, OPTIONS) that a
 * browser sent on behalf of a page from another origin, so such a page cannot
 * use the signed-in user's session cookie to, for example, sync a roster,
 * create Canvas assignments or add someone to a course. It follows Go's
 * net/http CrossOriginProtection (Go 1.25):
 *
 *   1. Sec-Fetch-Site decides when the browser sends it (every current browser
 *      does): "same-origin" and "none" (typed, bookmarked) pass, "same-site"
 *      and "cross-site" are refused. Refusing same-site matters at UBC: every
 *      *.ubc.ca site is same-site with GRASP, so a SameSite cookie alone would
 *      still go out with their requests.
 *   2. Without it (older browsers), the Origin header's host must be the host
 *      the request was sent to.
 *   3. With neither header, the request is same-origin from an old browser or
 *      not from a browser at all (curl, a server-side client), which has no
 *      victim's cookie to send.
 *
 * Exempt paths take cross-site POSTs by design: the UBC IdP posts SAML
 * responses and logout messages from its own origin, and passport-saml checks
 * their signatures instead.
 */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Express matches routes case-insensitively and ignores a trailing slash, so
// an exempt path is compared the same way.
function normalizePath(path) {
  return path.toLowerCase().replace(/\/+$/, '') || '/';
}

function originHost(origin) {
  try {
    return new URL(origin).host.toLowerCase();
  } catch {
    // Unparseable, including the opaque "null" origin.
    return null;
  }
}

function isSameOrigin(req) {
  const fetchSite = req.get('Sec-Fetch-Site');
  if (fetchSite) return fetchSite === 'same-origin' || fetchSite === 'none';

  const origin = req.get('Origin');
  if (!origin) return true;

  const host = originHost(origin);
  // req.host is X-Forwarded-Host behind the proxy (trust proxy), the Host
  // header otherwise; either one names this server, and a page cannot set
  // either on a victim's request.
  const requestHosts = [req.get('Host'), req.host]
    .filter(Boolean)
    .map((value) => value.toLowerCase());
  return host !== null && requestHosts.includes(host);
}

/**
 * @param {{ exemptPaths?: string[] }} [options]
 * @returns {import('express').RequestHandler}
 */
function createCrossOriginProtection({ exemptPaths = [] } = {}) {
  const exempt = new Set(exemptPaths.map(normalizePath));

  return function crossOriginProtection(req, res, next) {
    if (SAFE_METHODS.has(req.method)) return next();
    if (exempt.has(normalizePath(req.path))) return next();
    if (isSameOrigin(req)) return next();

    console.warn(
      `[cross-origin] Refused ${req.method} ${req.path} ` +
      `(Sec-Fetch-Site: ${req.get('Sec-Fetch-Site') || '(absent)'}, Origin: ${req.get('Origin') || '(absent)'})`
    );
    const error = 'Cross-origin request refused';
    if (req.path.startsWith('/api/')) {
      return res.status(403).json({ success: false, error });
    }
    return res.status(403).send(`403: ${error}`);
  };
}

module.exports = { createCrossOriginProtection };
