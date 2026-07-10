const express = require('express');
const request = require('supertest');

jest.mock('../../src/services/user', () => ({
  updateUserProfile: jest.fn(),
}));

jest.mock('../../src/utils/auth', () => ({
  getUserRole: jest.fn(),
  isAppAdministrator: jest.fn(),
  ROLES: { FACULTY: 'faculty', STAFF: 'staff', STUDENT: 'student' },
}));

const userService = require('../../src/services/user');
const { getUserRole, isAppAdministrator } = require('../../src/utils/auth');
const profileRouter = require('../../src/routes/profile');

const SESSION_USER = {
  _id: 'user-1',
  puid: 'puid-1',
  affiliation: ['student'],
  displayName: 'Original Name',
  email: 'original@example.com',
};

function buildApp(user = { ...SESSION_USER }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.use('/profile', profileRouter);
  return app;
}

describe('profile routes', () => {
  beforeEach(() => {
    userService.updateUserProfile.mockReset();
    getUserRole.mockReset().mockResolvedValue('student');
    isAppAdministrator.mockReset().mockResolvedValue(false);
  });

  it('validates profile fields before attempting an update', async () => {
    const response = await request(buildApp())
      .put('/profile')
      .send({ displayName: '   ', email: 'not-an-email' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      success: false,
      error: 'Display name is required.',
    });
    expect(userService.updateUserProfile).not.toHaveBeenCalled();
  });

  it('updates the authenticated user and ignores identity fields from the body', async () => {
    userService.updateUserProfile.mockResolvedValue({
      ...SESSION_USER,
      displayName: 'Updated Name',
      email: 'updated@example.com',
    });

    const response = await request(buildApp())
      .put('/profile')
      .send({
        displayName: ' Updated Name ',
        email: 'UPDATED@example.com',
        puid: 'another-user',
        affiliation: ['faculty'],
      });

    expect(response.status).toBe(200);
    expect(userService.updateUserProfile).toHaveBeenCalledWith(
      expect.objectContaining({ _id: 'user-1', puid: 'puid-1' }),
      { displayName: 'Updated Name', email: 'updated@example.com' }
    );
    expect(response.body.user).toMatchObject({
      _id: 'user-1',
      displayName: 'Updated Name',
      email: 'updated@example.com',
      role: 'student',
      isStudent: true,
    });
  });
});
