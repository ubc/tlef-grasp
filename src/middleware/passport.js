/**
 * Passport and SAML Configuration
 *
 * Sets up Passport with SAML strategy for CWL authentication
 */

const passport = require('passport');
const { Strategy } = require('passport-ubcshib');
const fs = require('fs');
const { createOrUpdateUser, getUserByPuid, updateUserLegalName } = require('../services/user');
const { getUserRole, ROLES } = require('../utils/auth');
const ubcApiService = require('../services/ubcApiService');

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

			const email = profile.attributes?.mail ||
				profile.attributes?.email ||
				profile['urn:oid:0.9.2342.19200300.100.1.3'] ||
				profile.mail ||
				profile.email ||
				profile.nameID;

			// CWL only reliably releases the email to this app (not a name), so the
			// displayName seed falls back to the email. The authoritative legal
			// name shown to instructors comes from the academic API during roster
			// sync (see syncStudentsToCourse), not from CWL.
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

				// CWL releases no usable name to this app, so enrich the
				// authoritative legal name (and a nicer displayName seed) from
				// the academic API. Best-effort and only when needed: skipped
				// once a legal name is known, and never allowed to fail login.
				let apiPerson = null;
				if (!user || !user.legalName) {
					try {
						apiPerson = await ubcApiService.getPersonByPuid(ubcEduCwlPuid);
					} catch (lookupError) {
						console.warn('Academic API legal-name lookup failed:', lookupError.message);
					}
				}

				if (null === user) {
					await createOrUpdateUser({
						// Prefer the academic-API preferred name for the editable
						// displayName seed; fall back to the CWL value (email).
						displayName: apiPerson?.preferredName || displayName,
						legalName: apiPerson?.legalName,
						email: email,
						affiliation: affiliations,
						puid: ubcEduCwlPuid,
					});
					user = await getUserByPuid(ubcEduCwlPuid);
				} else if (apiPerson?.legalName && user.legalName !== apiPerson.legalName) {
					// Existing user missing a legal name (e.g. an instructor, or a
					// student who logged in before this field existed): backfill it
					// without touching their editable displayName.
					await updateUserLegalName(ubcEduCwlPuid, apiPerson.legalName);
					user = { ...user, legalName: apiPerson.legalName };
				}

				// Get user role for session
				const role = await getUserRole(user);

				return done(null, { 
					...user, 
					role,
					nameID: profile.nameID,
					nameIDFormat: profile.nameIDFormat,
					nameIDNameQualifier: profile.nameIDNameQualifier,
					nameIDSPNameQualifier: profile.nameIDSPNameQualifier
				});
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
		_id: user._id ? user._id.toString() : user._id,
		// Alias so controllers can use either req.user.id or req.user._id
		id: user._id ? user._id.toString() : user._id,
		nameID: user.nameID,
		nameIDFormat: user.nameIDFormat,
		nameIDNameQualifier: user.nameIDNameQualifier,
		nameIDSPNameQualifier: user.nameIDSPNameQualifier
	};

	// Store full user object in session
	done(null, userObj);
});

// Deserialize user from session
// Runs on EVERY authenticated request
passport.deserializeUser((user, done) => {
	// User is already stored in session from serializeUser.
	// Backfill the id alias for sessions created before it was added.
	if (user && !user.id && user._id) {
		user.id = user._id;
	}
	done(null, user);
});

module.exports = { passport, VALID_AFFILIATIONS, ROLES };
