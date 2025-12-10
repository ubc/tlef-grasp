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

// Logout
router.get('/logout', logout('/'));

module.exports = router;