/**
 * Authentication Routes
 *
 * Handles SAML login, logout, and callback routes
 */

const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth');
const { samlErrorHandler } = require('../middleware/samlErrorHandler');

// Login route - redirects to UBC IdP
router.get('/ubcshib', authController.login);

// Callback route - called by UBC IdP after authentication or logout
router.all(
	'/saml/callback',
	authController.callback,
	authController.callbackSuccess,
	samlErrorHandler
);

// Logout
router.get('/logout', authController.logoutHandler);

module.exports = router;