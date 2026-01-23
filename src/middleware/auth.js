const { getUserRole, hasMinimumRole, ROLES } = require("../utils/auth");

/**
 * Custom middleware for API routes - returns JSON instead of redirecting
 */
function ensureAuthenticatedAPI(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    }
    res.status(401).json({
        success: false,
        error: 'Authentication required',
        authenticated: false
    });
}

/**
 * Middleware to require minimum role for access
 * @param {string} minRole - Minimum required role (faculty, staff, or student)
 */
function requireRole(minRole) {
    return async (req, res, next) => {
        if (!req.isAuthenticated()) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required',
                authenticated: false
            });
        }

        const hasAccess = await hasMinimumRole(req.user, minRole);
        if (!hasAccess) {
            return res.status(403).json({
                success: false,
                error: 'Access denied. Insufficient permissions.',
                requiredRole: minRole
            });
        }

        next();
    };
}

/**
 * Page-level role check middleware for HTML pages
 * Redirects to appropriate page based on role
 */
function requirePageRole(minRole) {
    return async (req, res, next) => {
        if (!req.isAuthenticated()) {
            return res.redirect('/auth/login');
        }

        const hasAccess = await hasMinimumRole(req.user, minRole);
        if (!hasAccess) {
            const userRole = await getUserRole(req.user);
            // Redirect students to their dashboard
            if (userRole === ROLES.STUDENT) {
                return res.redirect('/student-dashboard');
            }
            return res.status(403).send('Access denied. Insufficient permissions.');
        }

        next();
    };
}

module.exports = {
    ensureAuthenticatedAPI,
    requireRole,
    requirePageRole
};
