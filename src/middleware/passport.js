/**
 * Passport and SAML Configuration
 *
 * Sets up Passport with SAML strategy for CWL authentication
 */

const passport = require('passport');
const { Strategy } = require('passport-ubcshib');
const fs = require('fs');
const path = require('path');
const { createOrUpdateUser, getUserByPuid } = require('../services/user');

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
		async (profile, done) => {
			// Extract UBC Shibboleth attributes
			// The attribute is called 'ubcEduCwlPuid' and can be in multiple formats:
			// 1. profile.attributes.ubcEduCwlPuid (friendly name)
			// 2. profile['urn:mace:dir:attribute-def:ubcEduCwlPuid'] (MACE format)
			// 3. profile['urn:oid:1.3.6.1.4.1.60.6.1.6'] (OID format)
			const ubcEduCwlPuid = profile.attributes?.ubcEduCwlPuid ||
				profile['urn:mace:dir:attribute-def:ubcEduCwlPuid'] ||
				profile['urn:oid:1.3.6.1.4.1.60.6.1.6'];
			const samlId = profile.nameID || ubcEduCwlPuid;

			const email = profile.attributes?.mail ||
				profile.attributes?.email ||
				profile['urn:oid:0.9.2342.19200300.100.1.3'] ||
				profile.mail ||
				profile.email ||
				profile.nameID;

			const displayName = profile.attributes?.displayName ||
				profile.attributes?.cn ||
				profile['urn:oid:2.16.840.1.113730.3.1.241'] ||
				email;
			const affiliations = profile.attributes?.eduPersonAffiliation ||
				profile['urn:oid:1.3.6.1.4.1.5923.1.1.1.1'] ||
				[];

			// Making sure PUID is present
			if (!ubcEduCwlPuid) {
				return done(new Error("PUID is required"));
			}

			// The application currently only supports faculty, and staff.
			// eduPersonAffiliation is a comma-separated string
			if (!affiliations.includes('faculty') && !affiliations.includes('staff')) {
				return done(new Error("The Grasp application is currently only accessible to faculty and staff"));
			}

			// Get database connection and save user
			try {
				let user = await getUserByPuid(ubcEduCwlPuid);

				if (null === user) {
					await createOrUpdateUser({
						displayName: displayName,
						email: email,
						affiliation: affiliations,
						puid: ubcEduCwlPuid,
						username: samlId
					});
					user = await getUserByPuid(ubcEduCwlPuid);
				}

				return done(null, user);
			} catch (error) {
				// Log error but don't fail authentication
				return done(new Error("Error saving user to database: " + error.message));
			}
		}
	)
);

// Serialize user to session
// Runs ONCE on login - stores full user data in session
// Convert ObjectId to string so it serializes properly to JSON
passport.serializeUser((user, done) => {
	// Convert MongoDB document to plain JavaScript object
	// Convert ObjectId to string for JSON serialization in session
	const userObj = {
		...user,
		_id: user._id ? user._id.toString() : user._id
	};

	// Store full user object in session
	// This avoids DB queries on every request
	done(null, userObj);
});

// Deserialize user from session
// Runs on EVERY authenticated request
// Simply returns the user stored in session (no DB query needed!)
passport.deserializeUser((user, done) => {
	// User is already stored in session from serializeUser
	// No database query needed - just return it
	done(null, user);
});

module.exports = { passport };