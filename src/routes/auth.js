/**
 * Authentication Routes
 *
 * Handles SAML login, logout, and callback routes
 */

const express = require('express');
const { passport } = require('../middleware/passport');
const { logout } = require('passport-ubcshib');
const router = express.Router();

// Login route - redirects to UBC IdP
router.get('/ubcshib', passport.authenticate('ubcshib'));

// Callback route - called by UBC IdP after authentication
router.post(
	'/saml/callback',
	passport.authenticate('ubcshib', { failureRedirect: '/login' }),
	(req, res) => {
		// Successful authentication
		res.redirect('/onboarding');
	}
);

// Shibboleth SP endpoint - traditional Shibboleth callback path
// Note: Mounted under /auth, so path is /auth/Shibboleth.sso/SAML2/POST
router.post(
	'/Shibboleth.sso/SAML2/POST',
	express.json(),
	express.urlencoded({ extended: true }),
	passport.authenticate('ubcshib', { failureRedirect: '/login' }),
	(req, res) => {
		res.redirect('/onboarding');
	}
);

// Logout
router.get('/logout', logout('/'));

module.exports = router;