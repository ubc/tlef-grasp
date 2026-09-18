// Manual course access (issue #115):
//   GET  /api/users/search/not-in-course/:courseId?q=  — find an account by
//        email or name (search-only, never a browsable list; instructors are
//        left out because they join with the invite code)
//   POST /api/users/course/:courseId/add — grant access as a plain member or
//        straight in as a TA; the membership is stamped with who granted it
//        and the grant is appended to the course access log
//   GET  /api/users/course/:courseId/access-log — the evidence, newest first

const express = require('express');
const request = require('supertest');

jest.mock('../../src/services/database', () => ({
  connect: jest.fn(),
}));

jest.mock('../../src/services/user-course', () => {
  const { MEMBERSHIP_SOURCES } = jest.requireActual('../../src/services/user-course');
  return {
    MEMBERSHIP_SOURCES,
    getCourseUsers: jest.fn(),
    createUserCourse: jest.fn(),
    deleteUserCourse: jest.fn(),
    isUserInCourse: jest.fn(),
    getUserCourseMembership: jest.fn(),
    setUserCourseRole: jest.fn(),
    setUserCourseTaPermissions: jest.fn(),
    countTaMemberships: jest.fn(),
  };
});

jest.mock('../../src/services/user', () => ({
  getStaffUsersNotInCourse: jest.fn(),
  getStudentsNotInCourse: jest.fn(),
  searchUsersNotInCourse: jest.fn(),
  getUserById: jest.fn(),
  grantPromotedStaffAffiliation: jest.fn(),
  revokePromotedStaffAffiliation: jest.fn(),
}));

jest.mock('../../src/services/course-access-log', () => {
  const { ACCESS_ACTIONS } = jest.requireActual('../../src/services/course-access-log');
  return {
    ACCESS_ACTIONS,
    recordCourseAccessEvent: jest.fn(),
    getCourseAccessLog: jest.fn(),
  };
});

jest.mock('../../src/services/course', () => ({
  getCourseById: jest.fn(),
}));

jest.mock('../../src/services/course-section', () => ({
  getSectionsOwnedByUser: jest.fn(),
}));

const userCourseService = require('../../src/services/user-course');
const userService = require('../../src/services/user');
const accessLog = require('../../src/services/course-access-log');
const usersRouter = require('../../src/routes/users');

const COURSE_ID = 'course-1';

const instructor = { _id: 'prof-1', id: 'prof-1', puid: 'prof-1', affiliation: ['faculty'] };
const taUser = {
  _id: 'ta-1',
  id: 'ta-1',
  puid: 'ta-1',
  affiliation: ['student', 'staff'],
  staffViaTaPromotion: true,
};
const studentUser = { _id: 'stu-1', id: 'stu-1', puid: 'stu-1', affiliation: ['student'] };

// Accounts that exist because their owners signed in once, but are in no course.
const guestStudent = {
  _id: 'guest-1',
  puid: 'guest-1',
  email: 'guest.ta@student.ubc.ca',
  displayName: 'Guest TA',
  legalName: 'Guest Teaching Assistant',
  affiliation: ['student'],
  courseCount: 0,
};
const guestStaff = {
  _id: 'guest-2',
  puid: 'guest-2',
  email: 'dept.staff@ubc.ca',
  displayName: 'Dept Staff',
  legalName: 'Department Staff',
  affiliation: ['staff'],
  courseCount: 2,
};
const guestFaculty = {
  _id: 'guest-3',
  puid: 'guest-3',
  email: 'other.prof@ubc.ca',
  displayName: 'Other Prof',
  legalName: 'Other Professor',
  affiliation: ['faculty'],
  courseCount: 1,
};

function buildApp(user) {
  const app = express();
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.use('/api/users', usersRouter);
  return app;
}

const searchUrl = `/api/users/search/not-in-course/${COURSE_ID}`;
const addUrl = `/api/users/course/${COURSE_ID}/add`;
const logUrl = `/api/users/course/${COURSE_ID}/access-log`;

beforeEach(() => {
  jest.clearAllMocks();
  userCourseService.isUserInCourse.mockResolvedValue(true);
});

describe('GET /api/users/search/not-in-course/:courseId', () => {
  it('returns non-member matches shaped for the picker, leaving instructors out', async () => {
    userService.searchUsersNotInCourse.mockResolvedValue([guestStudent, guestStaff, guestFaculty]);

    const res = await request(buildApp(instructor)).get(searchUrl).query({ q: 'guest' });

    expect(res.status).toBe(200);
    expect(userService.searchUsersNotInCourse).toHaveBeenCalledWith(COURSE_ID, 'guest', {
      limit: 10,
    });
    expect(res.body.users).toEqual([
      {
        _id: 'guest-1',
        email: 'guest.ta@student.ubc.ca',
        displayName: 'Guest TA',
        legalName: 'Guest Teaching Assistant',
        affiliation: ['student'],
        role: 'student',
        courseCount: 0,
      },
      {
        _id: 'guest-2',
        email: 'dept.staff@ubc.ca',
        displayName: 'Dept Staff',
        legalName: 'Department Staff',
        affiliation: ['staff'],
        role: 'staff',
        courseCount: 2,
      },
    ]);
    // puid is not something the picker needs.
    expect(res.body.users[0]).not.toHaveProperty('puid');
  });

  it('offers a TA of another course as the student they are here', async () => {
    userService.searchUsersNotInCourse.mockResolvedValue([{ ...taUser, courseCount: 1 }]);

    const res = await request(buildApp(instructor)).get(searchUrl).query({ q: 'ta-1' });

    expect(res.status).toBe(200);
    expect(res.body.users[0].role).toBe('student');
  });

  it('requires enough of an email or name to search', async () => {
    const res = await request(buildApp(instructor)).get(searchUrl).query({ q: 'ab' });

    expect(res.status).toBe(400);
    expect(userService.searchUsersNotInCourse).not.toHaveBeenCalled();
  });

  it('trims the query before checking its length', async () => {
    const res = await request(buildApp(instructor)).get(searchUrl).query({ q: '  ab  ' });

    expect(res.status).toBe(400);
  });

  it('is faculty-only: TAs and students cannot search accounts', async () => {
    for (const caller of [taUser, studentUser]) {
      const res = await request(buildApp(caller)).get(searchUrl).query({ q: 'guest' });
      expect(res.status).toBe(403);
    }
    expect(userService.searchUsersNotInCourse).not.toHaveBeenCalled();
  });

  it('rejects an instructor who is not a member of the course', async () => {
    userCourseService.isUserInCourse.mockResolvedValue(false);

    const res = await request(buildApp(instructor)).get(searchUrl).query({ q: 'guest' });

    expect(res.status).toBe(403);
    expect(userService.searchUsersNotInCourse).not.toHaveBeenCalled();
  });
});

describe('POST /api/users/course/:courseId/add', () => {
  beforeEach(() => {
    // The target is not in the course yet; the instructor is.
    userCourseService.isUserInCourse.mockImplementation(async (userId) => userId === 'prof-1');
  });

  it('adds a plain member, stamped with who granted it, and logs the grant', async () => {
    userService.getUserById.mockResolvedValue(guestStudent);

    const res = await request(buildApp(instructor)).post(addUrl).send({ userId: 'guest-1' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      message: 'User added to course successfully',
      role: 'student',
    });
    expect(userCourseService.createUserCourse).toHaveBeenCalledWith('guest-1', COURSE_ID, {
      source: 'manual',
      addedBy: 'prof-1',
    });
    expect(userCourseService.setUserCourseRole).not.toHaveBeenCalled();
    expect(userService.grantPromotedStaffAffiliation).not.toHaveBeenCalled();
    expect(accessLog.recordCourseAccessEvent).toHaveBeenCalledWith({
      courseId: COURSE_ID,
      targetUserId: 'guest-1',
      actorUserId: 'prof-1',
      action: 'added',
      role: 'student',
    });
  });

  it('adds someone straight in as a TA: membership, role, clean permissions, staff affiliation', async () => {
    userService.getUserById.mockResolvedValue(guestStudent);

    const res = await request(buildApp(instructor))
      .post(addUrl)
      .send({ userId: 'guest-1', role: 'ta' });

    expect(res.status).toBe(200);
    expect(res.body.role).toBe('ta');
    expect(res.body.message).toMatch(/as a TA/);
    expect(userCourseService.createUserCourse).toHaveBeenCalledWith('guest-1', COURSE_ID, {
      source: 'manual',
      addedBy: 'prof-1',
    });
    expect(userCourseService.setUserCourseRole).toHaveBeenCalledWith('guest-1', COURSE_ID, 'ta', {
      changedBy: 'prof-1',
    });
    expect(userCourseService.setUserCourseTaPermissions).toHaveBeenCalledWith(
      'guest-1',
      COURSE_ID,
      null
    );
    expect(userService.grantPromotedStaffAffiliation).toHaveBeenCalledWith('guest-1');
    expect(accessLog.recordCourseAccessEvent).toHaveBeenCalledWith({
      courseId: COURSE_ID,
      targetUserId: 'guest-1',
      actorUserId: 'prof-1',
      action: 'added',
      role: 'ta',
    });
  });

  it('records a SAML staff account added as a member with the staff role it will hold', async () => {
    userService.getUserById.mockResolvedValue(guestStaff);

    const res = await request(buildApp(instructor))
      .post(addUrl)
      .send({ userId: 'guest-2', role: 'member' });

    expect(res.status).toBe(200);
    expect(res.body.role).toBe('staff');
    expect(accessLog.recordCourseAccessEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'added', role: 'staff' })
    );
  });

  it('refuses to add an instructor: they join with the invite code', async () => {
    userService.getUserById.mockResolvedValue(guestFaculty);

    const res = await request(buildApp(instructor)).post(addUrl).send({ userId: 'guest-3' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invite code/);
    expect(userCourseService.createUserCourse).not.toHaveBeenCalled();
    expect(accessLog.recordCourseAccessEvent).not.toHaveBeenCalled();
  });

  it('rejects an unknown role', async () => {
    const res = await request(buildApp(instructor))
      .post(addUrl)
      .send({ userId: 'guest-1', role: 'faculty' });

    expect(res.status).toBe(400);
    expect(userCourseService.createUserCourse).not.toHaveBeenCalled();
  });

  it('rejects an account that is already in the course', async () => {
    userCourseService.isUserInCourse.mockResolvedValue(true);

    const res = await request(buildApp(instructor)).post(addUrl).send({ userId: 'guest-1' });

    expect(res.status).toBe(409);
    expect(userCourseService.createUserCourse).not.toHaveBeenCalled();
  });

  it('rejects an account that does not exist', async () => {
    userService.getUserById.mockResolvedValue(null);

    const res = await request(buildApp(instructor)).post(addUrl).send({ userId: 'nobody' });

    expect(res.status).toBe(404);
    expect(userCourseService.createUserCourse).not.toHaveBeenCalled();
  });

  it('requires a userId', async () => {
    const res = await request(buildApp(instructor)).post(addUrl).send({ role: 'ta' });

    expect(res.status).toBe(400);
  });

  it('is faculty-only: a TA cannot add people', async () => {
    const res = await request(buildApp(taUser)).post(addUrl).send({ userId: 'guest-1' });

    expect(res.status).toBe(403);
    expect(userCourseService.createUserCourse).not.toHaveBeenCalled();
  });
});

describe('GET /api/users/course/:courseId/access-log', () => {
  it('returns the course events newest first for an instructor in the course', async () => {
    const events = [
      { _id: 'e2', action: 'removed', role: 'ta', createdAt: '2026-09-18T10:00:00.000Z' },
      { _id: 'e1', action: 'added', role: 'ta', createdAt: '2026-09-17T10:00:00.000Z' },
    ];
    accessLog.getCourseAccessLog.mockResolvedValue(events);

    const res = await request(buildApp(instructor)).get(logUrl);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, events });
    expect(accessLog.getCourseAccessLog).toHaveBeenCalledWith(COURSE_ID, { limit: 100 });
  });

  it('honours a positive limit and ignores a bad one', async () => {
    accessLog.getCourseAccessLog.mockResolvedValue([]);

    await request(buildApp(instructor)).get(logUrl).query({ limit: '25' });
    expect(accessLog.getCourseAccessLog).toHaveBeenLastCalledWith(COURSE_ID, { limit: 25 });

    await request(buildApp(instructor)).get(logUrl).query({ limit: '-5' });
    expect(accessLog.getCourseAccessLog).toHaveBeenLastCalledWith(COURSE_ID, { limit: 100 });
  });

  it('is instructor-only, even for a TA with the users permission', async () => {
    userCourseService.getUserCourseMembership.mockResolvedValue({ courseRole: 'ta' });

    const res = await request(buildApp(taUser)).get(logUrl);

    expect(res.status).toBe(403);
    expect(accessLog.getCourseAccessLog).not.toHaveBeenCalled();
  });

  it('rejects an instructor who is not a member of the course', async () => {
    userCourseService.isUserInCourse.mockResolvedValue(false);

    const res = await request(buildApp(instructor)).get(logUrl);

    expect(res.status).toBe(403);
  });
});

describe('GET /api/users/course/:courseId (roster provenance)', () => {
  it('lists a manually added student to every instructor, with who let them in', async () => {
    const addedBy = { _id: 'prof-1', legalName: 'Prof One', email: 'prof1@ubc.ca' };
    userCourseService.getUserCourseMembership.mockResolvedValue({});
    userCourseService.getCourseUsers.mockResolvedValue([
      {
        userId: 'guest-1',
        source: 'manual',
        addedBy,
        joinedAt: '2026-09-18T09:00:00.000Z',
        user: guestStudent,
        sections: [],
      },
      // A roster-synced student in a section this instructor does not own.
      {
        userId: 'stu-9',
        source: 'roster-sync',
        user: { _id: 'stu-9', affiliation: ['student'] },
        sections: ['SEC-OTHER'],
      },
    ]);
    require('../../src/services/course-section').getSectionsOwnedByUser.mockResolvedValue([]);

    const res = await request(buildApp(instructor)).get(`/api/users/course/${COURSE_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.users).toHaveLength(1);
    expect(res.body.users[0]).toEqual(
      expect.objectContaining({
        userId: 'guest-1',
        courseRole: 'student',
        source: 'manual',
        addedBy,
        joinedAt: '2026-09-18T09:00:00.000Z',
      })
    );
  });

  it('tells the page what a TA reverts to when the designation is removed', async () => {
    userCourseService.getUserCourseMembership.mockResolvedValue({});
    userCourseService.getCourseUsers.mockResolvedValue([
      { userId: 'ta-1', courseRole: 'ta', user: taUser, sections: [] },
      {
        userId: 'staff-ta',
        courseRole: 'ta',
        user: { _id: 'staff-ta', puid: 'staff-ta', affiliation: ['staff'] },
        sections: [],
      },
    ]);
    require('../../src/services/course-section').getSectionsOwnedByUser.mockResolvedValue([]);

    const res = await request(buildApp(instructor)).get(`/api/users/course/${COURSE_ID}`);

    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.users.map((u) => [u.userId, u]));
    expect(byId['ta-1'].courseRole).toBe('ta');
    expect(byId['ta-1'].baseRole).toBe('student');
    expect(byId['staff-ta'].courseRole).toBe('ta');
    expect(byId['staff-ta'].baseRole).toBe('staff');
  });
});
