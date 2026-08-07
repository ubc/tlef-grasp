const express = require('express');
const request = require('supertest');

jest.mock('../../src/utils/course-access', () => ({
  hasStaffAccessInCourse: jest.fn(),
}));

jest.mock('../../src/utils/auth', () => ({
  isAppAdministrator: jest.fn(),
}));

jest.mock('../../src/services/course-section', () => ({
  getCourseSections: jest.fn(),
  getSectionsOwnedByUser: jest.fn(),
}));

jest.mock('../../src/services/lms-section-link', () => ({
  removeSectionLmsLink: jest.fn(),
}));

const { hasStaffAccessInCourse } = require('../../src/utils/course-access');
const { isAppAdministrator } = require('../../src/utils/auth');
const { getSectionsOwnedByUser } = require('../../src/services/course-section');
const lmsSectionLinkService = require('../../src/services/lms-section-link');
const lmsRoutes = require('../../src/routes/lms');

function buildApp() {
  const app = express();
  app.use((req, _res, next) => {
    req.user = { _id: '507f1f77bcf86cd799439011' };
    next();
  });
  app.use('/api/lms', lmsRoutes);
  return app;
}

describe('Provider-neutral LMS routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    hasStaffAccessInCourse.mockResolvedValue(true);
    isAppAdministrator.mockResolvedValue(false);
    getSectionsOwnedByUser.mockResolvedValue([{ sectionId: '101' }]);
    lmsSectionLinkService.removeSectionLmsLink.mockResolvedValue(true);
  });

  it('removes a section link without requiring either provider connection', async () => {
    const response = await request(buildApp())
      .delete('/api/lms/courses/local-1/sections/101/link');

    expect(response.status).toBe(204);
    expect(lmsSectionLinkService.removeSectionLmsLink).toHaveBeenCalledWith(
      'local-1',
      '101'
    );
  });

  it('does not let an instructor remove another owner’s section link', async () => {
    getSectionsOwnedByUser.mockResolvedValue([]);

    const response = await request(buildApp())
      .delete('/api/lms/courses/local-1/sections/101/link');

    expect(response.status).toBe(403);
    expect(lmsSectionLinkService.removeSectionLmsLink).not.toHaveBeenCalled();
  });
});
