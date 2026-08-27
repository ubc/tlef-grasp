/**
 * Turns an expired or already-used SAML request ID into a redirect back to
 * login rather than a 500. node-saml throws for these, and a thrown error
 * bypasses passport's failureRedirect, so without this the user sees an error
 * page for what is really just a stale login attempt. Anything else — a bad
 * signature, an audience mismatch — is passed through to the real error
 * handler, which logs it.
 */

const STALE_REQUEST_ERRORS = [
	'InResponseTo is not valid',
	'InResponseTo is missing from response',
];

function samlErrorHandler(err, req, res, next) {
	if (err && STALE_REQUEST_ERRORS.includes(err.message)) {
		console.warn('Stale SAML login attempt:', err.message);
		return res.redirect('/auth/login?error=stale_login');
	}
	return next(err);
}

module.exports = { samlErrorHandler };
