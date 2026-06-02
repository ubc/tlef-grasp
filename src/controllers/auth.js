// No longer using logout middleware from passport-ubcshib as we implement custom SLO logic
const { passport } = require('../middleware/passport');

const login = passport.authenticate('ubcshib');

const callback = passport.authenticate('ubcshib');

const callbackSuccess = (req, res) => {
  // If user is not authenticated, it's likely a logout response from IdP
  if (!req.isAuthenticated()) {
    return res.redirect('/');
  }
  // Successful authentication
  res.redirect('/onboarding');
};

const logoutHandler = (req, res) => {
  if (!req.isAuthenticated()) {
    return res.redirect('/');
  }

  // Get the SAML strategy to generate the logout request
  const strategy = passport._strategies.ubcshib;
  
  if (!strategy) {
    console.error('SAML Strategy (ubcshib) not found in passport');
    return req.logout((err) => {
      if (req.session) {
        req.session.destroy(() => {
          res.clearCookie('grasp.sid');
          res.redirect('/');
        });
      } else {
        res.redirect('/');
      }
    });
  }

  strategy.logout(req, (err, requestUrl) => {
    if (err) {
      console.error('SAML Logout Error:', err);
      return req.logout((err) => {
        if (req.session) {
          req.session.destroy(() => {
            res.clearCookie('grasp.sid');
            res.redirect('/');
          });
        } else {
          res.redirect('/');
        }
      });
    }
    
    // Clear local session BEFORE redirecting to IdP
    // This often helps avoid redirect loops where the IdP thinks the SP session is still active
    req.logout((logoutErr) => {
      if (logoutErr) console.error('Passport logout error during SLO:', logoutErr);
      
      if (req.session) {
        req.session.destroy((destroyErr) => {
          if (destroyErr) console.error('Session destruction error during SLO:', destroyErr);
          res.clearCookie('grasp.sid');
          // Redirect to IdP with the SAML LogoutRequest
          res.redirect(requestUrl);
        });
      } else {
        res.redirect(requestUrl);
      }
    });
  });
};

module.exports = {
  login,
  callback,
  callbackSuccess,
  logoutHandler
};
