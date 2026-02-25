/**
 * Authentication Routes
 *
 * Handles SAML login, logout, and callback routes
 */

const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth');

// Login route - redirects to UBC IdP
router.get('/ubcshib', authController.login);

// Callback route - called by UBC IdP after authentication
router.post(
	'/saml/callback',
	authController.callback,
	authController.callbackSuccess
);

// Logout
router.get('/logout', authController.logoutHandler);

module.exports = router;