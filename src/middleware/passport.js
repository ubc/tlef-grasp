/**
 * Passport and SAML Configuration
 *
 * Sets up Passport with SAML strategy for CWL authentication
 */

const passport = require('passport');
const { Strategy } = require('passport-ubcshib');
const fs = require('fs');
const path = require('path');

passport.use(
	new Strategy(
		{
			// Service Provider Identity (usually your app's URL)
			issuer: process.env.SAML_ISSUER,

			// Callback URL after authentication
			callbackUrl: process.env.SAML_CALLBACK_URL,

			// Path to your application's private key for signing SAML requests
			privateKeyPath: process.env.SAML_PRIVATE_KEY_PATH,
            cert: fs.readFileSync(process.env.SAML_CERT_PATH, 'utf8'),

			// Specify which attributes your app needs
			// See ATTRIBUTES.md for full list of available attributes
			attributeConfig: ['ubcEduCwlPuid', 'mail', 'eduPersonAffiliation'],

			// Optional: Enable single logout
			enableSLO: true,
		},
		// Verify callback: called with user profile after successful authentication
		(profile, done) => {
			// profile.nameID - SAML nameID
			// profile.attributes - Mapped attributes based on attributeConfig

			console.log(profile);
            return done(null, profile);
		}
	)
);

// Serialize user to session
passport.serializeUser((user, done) => {
    done(null, user);
});

// Deserialize user from session
passport.deserializeUser((user, done) => {
    done(null, user);
});

module.exports = { passport };