// src/routes/auth.js
const express = require('express');
const { passport, samlStrategy } = require('../middleware/passport');
const router = express.Router();

// Start SAML login
router.get('/login', (req, res, next) => {
  return passport.authenticate('saml', {
    failureRedirect: '/auth/login-failed',
    successRedirect: '/',
  })(req, res, next);
});

// ACS endpoint - IdP POSTS SAMLResponse here
router.post('/saml/callback',
  passport.authenticate('saml', {
    failureRedirect: '/auth/login-failed',
    failureFlash: false,
  }),
  (req, res) => {
    // Successful login - redirect based on user role
    if (req.user && req.user.role === 'instructor') {
      res.redirect('/dashboard');
    } else if (req.user && req.user.role === 'student') {
      res.redirect('/student-dashboard');
    } else {
      // Fallback to root (which will redirect based on role)
      res.redirect('/');
    }
  }
);

// Logout (SP-initiated SLO)
router.get('/logout', (req, res, next) => {
  if (!req.user) return res.redirect('/');
  samlStrategy.logout(req, (err, requestUrl) => {
    if (err) return next(err);
    // Local logout
    req.logout(err2 => {
      if (err2) return next(err2);
      req.session.destroy(() => {
        // Redirect to IdP logout
        res.redirect(requestUrl);
      });
    });
  });
});

// IdP redirects here after SLO completes
router.get('/logout/callback', (_req, res) => {
  res.redirect('/');
});

// Simple status endpoint for the frontend
router.get('/me', (req, res) => {
  if (req.isAuthenticated()) {
    const { id, email, givenName, familyName, displayName, eppn, role, affiliation } = req.user;
    return res.json({ 
      authenticated: true, 
      user: { id, email, givenName, familyName, displayName, eppn, role, affiliation } 
    });
  }
  res.json({ authenticated: false });
});

// Optional: SP metadata for quick IdP setup
router.get('/metadata', (req, res) => {
  const meta = samlStrategy.generateServiceProviderMetadata();
  res.type('application/xml').send(meta);
});

// Optional failure page
router.get('/login-failed', (_req, res) => {
  res.status(401).send('<h1>Login Failed</h1><a href="/auth/login">Try again</a>');
});

module.exports = router;
