jest.mock('../../src/utils/auth', () => ({
  ROLES: {
    FACULTY: 'faculty',
    STAFF: 'staff',
    STUDENT: 'student',
  },
  getUserRole: jest.fn(),
  hasMinimumRole: jest.fn(),
}));

const { getUserRole, hasMinimumRole, ROLES } = require('../../src/utils/auth');
const {
  ensureAuthenticatedAPI,
  requirePageRole,
  requireRole,
} = require('../../src/middleware/auth');

function mockResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    redirect: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  };
}

describe('auth middleware', () => {
  beforeEach(() => {
    hasMinimumRole.mockReset();
    getUserRole.mockReset();
  });

  it('returns JSON 401 for unauthenticated API requests', () => {
    const req = { isAuthenticated: jest.fn(() => false) };
    const res = mockResponse();
    const next = jest.fn();

    ensureAuthenticatedAPI(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Authentication required',
      authenticated: false,
    });
  });

  it('passes authenticated API requests through', () => {
    const req = { isAuthenticated: jest.fn(() => true) };
    const res = mockResponse();
    const next = jest.fn();

    ensureAuthenticatedAPI(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('enforces minimum roles for API routes', async () => {
    hasMinimumRole.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const req = { isAuthenticated: jest.fn(() => true), user: { _id: 'user-1' } };
    const deniedRes = mockResponse();

    await requireRole(ROLES.FACULTY)(req, deniedRes, jest.fn());

    expect(deniedRes.status).toHaveBeenCalledWith(403);
    expect(deniedRes.json).toHaveBeenCalledWith({
      success: false,
      error: 'Access denied. Insufficient permissions.',
      requiredRole: ROLES.FACULTY,
    });

    const allowedNext = jest.fn();
    await requireRole(ROLES.STAFF)(req, mockResponse(), allowedNext);

    expect(allowedNext).toHaveBeenCalledTimes(1);
  });

  it('redirects unauthenticated page requests to login', async () => {
    const req = { isAuthenticated: jest.fn(() => false) };
    const res = mockResponse();

    await requirePageRole(ROLES.FACULTY)(req, res, jest.fn());

    expect(res.redirect).toHaveBeenCalledWith('/auth/login');
  });

  it('redirects denied students to their dashboard and sends 403 for other denied roles', async () => {
    hasMinimumRole.mockResolvedValue(false);
    getUserRole.mockResolvedValueOnce(ROLES.STUDENT).mockResolvedValueOnce(ROLES.STAFF);
    const req = { isAuthenticated: jest.fn(() => true), user: { _id: 'user-1' } };

    const studentRes = mockResponse();
    await requirePageRole(ROLES.FACULTY)(req, studentRes, jest.fn());
    expect(studentRes.redirect).toHaveBeenCalledWith('/student-dashboard');

    const staffRes = mockResponse();
    await requirePageRole(ROLES.FACULTY)(req, staffRes, jest.fn());
    expect(staffRes.status).toHaveBeenCalledWith(403);
    expect(staffRes.send).toHaveBeenCalledWith(
      'Access denied. Insufficient permissions.'
    );
  });
});
