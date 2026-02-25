const { passport } = require('../middleware/passport');
const { logout } = require('passport-ubcshib');

const login = passport.authenticate('ubcshib');

const callback = passport.authenticate('ubcshib', { failureRedirect: '/login' });

const callbackSuccess = (req, res) => {
  // Successful authentication
  res.redirect('/onboarding');
};

const logoutHandler = logout('/');

module.exports = {
  login,
  callback,
  callbackSuccess,
  logoutHandler
};
