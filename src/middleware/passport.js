// src/middleware/passport.js
const passport = require('passport');
const { Strategy: SamlStrategy } = require('passport-saml');
const fs = require('fs');
const path = require('path');

function readIdpCert() {
  if (process.env.SAML_IDP_CERT) {
    // Single-line or \n-separated env string, without BEGIN/END
    return process.env.SAML_IDP_CERT.replace(/\\n/g, '\n').trim();
  }
  if (process.env.SAML_CERT_PATH) {
    const p = path.resolve(process.env.SAML_CERT_PATH);
    return fs.readFileSync(p, 'utf8');
  }
  throw new Error('Missing SAML_IDP_CERT or SAML_CERT_PATH for IdP cert.');
}

const samlConfig = {
  entryPoint: process.env.SAML_ENTRY_POINT,                 // IdP SSO URL
  logoutUrl: process.env.SAML_LOGOUT_URL,                   // IdP SLO URL (optional but recommended)
  callbackUrl: process.env.SAML_CALLBACK_URL,               // ACS
  logoutCallbackUrl: process.env.SAML_LOGOUT_CALLBACK_URL,  // SLO callback at SP
  issuer: process.env.SAML_ISSUER,                          // SP EntityID
  cert: readIdpCert(),                                      // IdP signing cert
  identifierFormat: null,                                   // let IdP choose
  disableRequestedAuthnContext: true,
  acceptedClockSkewMs: 5000,
};

const strategy = new SamlStrategy(samlConfig, (profile, done) => {
  // Normalize attributes coming from SimpleSAMLphp / campus IdP
  const email =
    profile.email ||
    profile.mail ||
    profile['urn:oid:0.9.2342.19200300.100.1.3'];

  const givenName =
    profile.givenName || profile['urn:oid:2.5.4.42'];

  const familyName =
    profile.sn || profile['urn:oid:2.5.4.4'];

  const displayName =
    profile.displayName || profile.cn;

  const eppn = profile.eduPersonPrincipalName;

  const user = {
    id: profile.nameID,
    nameID: profile.nameID,
    nameIDFormat: profile.nameIDFormat,
    email,
    givenName,
    familyName,
    displayName,
    eppn,
    sessionIndex: profile.sessionIndex,
    raw: profile,
  };

  return done(null, user);
});

passport.use('saml', strategy);

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

module.exports = { passport, samlStrategy: strategy };
