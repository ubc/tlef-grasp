/**
 * Passport and SAML Configuration
 *
 * Sets up Passport with SAML strategy for CWL authentication
 */

const passport = require('passport');
const { Strategy } = require('passport-ubcshib');
const fs = require('fs');
const { createOrUpdateUser, getUserByPuid } = require('../services/user');
const { getUserRole, ROLES } = require('../utils/auth');

// Valid affiliations that can access the application
const VALID_AFFILIATIONS = ['faculty', 'staff', 'student', 'affiliate'];

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
				return done(new Error('PUID is required'));
			}

			// Check if user has a valid affiliation (faculty, staff, student, or affiliate)
			const hasValidAffiliation = VALID_AFFILIATIONS.some(aff => affiliations.includes(aff));
			
			if (!hasValidAffiliation) {
				return done(new Error('Access denied. This application is only available to UBC faculty, staff, and students.'));
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

				// Get user role for session
				const role = await getUserRole(user);

				return done(null, { ...user, role });
			} catch (error) {
				return done(new Error('Error saving user to database: ' + error.message));
			}
		}
	)
);

// Serialize user to session
// Runs ONCE on login - stores full user data in session
passport.serializeUser((user, done) => {
	// Convert MongoDB document to plain JavaScript object
	const userObj = {
		...user,
		_id: user._id ? user._id.toString() : user._id
	};

	// Store full user object in session
	done(null, userObj);
});

// Deserialize user from session
// Runs on EVERY authenticated request
passport.deserializeUser((user, done) => {
	// User is already stored in session from serializeUser
	done(null, user);
});

module.exports = { passport, VALID_AFFILIATIONS, ROLES };
