// src/middleware/requireRole.js

/**
 * Middleware to require authentication and specific role
 * @param {string} requiredRole - 'instructor' or 'student'
 * @returns {Function} Express middleware function
 */
function requireRole(requiredRole) {
  return function(req, res, next) {
    // Check if user is authenticated
    if (!req.isAuthenticated || !req.isAuthenticated()) {
      // For HTML pages, redirect to login
      if (req.accepts('html')) {
        return res.redirect('/auth/login');
      }
      // For API calls, return 401
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Check if user has the required role
    if (req.user.role !== requiredRole) {
      // Redirect to appropriate dashboard based on actual role
      if (req.accepts('html')) {
        const redirectTo = req.user.role === 'instructor' ? '/dashboard' : '/student-dashboard';
        return res.redirect(redirectTo);
      }
      // For API calls, return 403
      return res.status(403).json({ 
        error: 'Access forbidden', 
        message: `This resource requires ${requiredRole} role`
      });
    }

    // User is authenticated and has correct role
    next();
  };
}

/**
 * Middleware to require instructor role
 */
function requireInstructor(req, res, next) {
  return requireRole('instructor')(req, res, next);
}

/**
 * Middleware to require student role
 */
function requireStudent(req, res, next) {
  return requireRole('student')(req, res, next);
}

/**
 * Middleware to require any authenticated user (any role)
 */
function requireAuth(req, res, next) {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    if (req.accepts('html')) {
      return res.redirect('/auth/login');
    }
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
}

module.exports = {
  requireRole,
  requireInstructor,
  requireStudent,
  requireAuth
};

