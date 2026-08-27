// The visibility half of soft deletion. "Freeing the course code" and
// "disabling the invite code" are not separate features — they are what falls
// out of every course lookup filtering `archived: { $ne: true }`. These tests
// pin the filters, because a lookup that forgets one silently keeps an archived
// course reserving its code or admitting students by invite.

jest.mock('../../src/services/database', () => ({
  connect: jest.fn(),
}));

const databaseService = require('../../src/services/database');
const {
  archiveCourse,
  unarchiveCourse,
  getCourseByCode,
  getCourseByEnrollmentCode,
  listCoursesForEnrollment,
  listArchivedCoursesForOwner,
} = require('../../src/services/course');

describe('course service archiving', () => {
  let collection;
  let cursor;

  beforeEach(() => {
    jest.clearAllMocks();
    cursor = {
      project: jest.fn(() => cursor),
      sort: jest.fn(() => cursor),
      limit: jest.fn(() => cursor),
      toArray: jest.fn().mockResolvedValue([]),
    };
    collection = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn(() => cursor),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    databaseService.connect.mockResolvedValue({
      collection: jest.fn(() => collection),
    });
  });

  describe('lookups exclude archived courses', () => {
    it('getCourseByCode releases the code of an archived course', async () => {
      await getCourseByCode('chem-121-v');
      expect(collection.findOne).toHaveBeenCalledWith({
        courseCode: 'chem-121-v',
        archived: { $ne: true },
      });
    });

    it('getCourseByEnrollmentCode stops honouring an archived invite', async () => {
      await getCourseByEnrollmentCode('  invite-code  ');
      expect(collection.findOne).toHaveBeenCalledWith({
        courseAccess: 'invite-code',
        archived: { $ne: true },
      });
    });

    it('listCoursesForEnrollment hides archived courses from the join browser', async () => {
      await listCoursesForEnrollment('');
      expect(collection.find).toHaveBeenCalledWith({ archived: { $ne: true } });
    });

    it('keeps the archived filter alongside a search term', async () => {
      await listCoursesForEnrollment('chem');
      const filter = collection.find.mock.calls[0][0];
      expect(filter.archived).toEqual({ $ne: true });
      expect(filter.$or).toHaveLength(2);
    });
  });

  describe('archiveCourse', () => {
    it('sets the flag and records who archived it and when', async () => {
      await archiveCourse('507f1f77bcf86cd799439011', '507f1f77bcf86cd799439012');

      const [filter, update] = collection.updateOne.mock.calls[0];
      expect(String(filter._id)).toBe('507f1f77bcf86cd799439011');
      expect(update.$set.archived).toBe(true);
      expect(update.$set.archivedAt).toBeInstanceOf(Date);
      expect(String(update.$set.archivedBy)).toBe('507f1f77bcf86cd799439012');
    });

    it('touches nothing else on the course', async () => {
      await archiveCourse('507f1f77bcf86cd799439011', '507f1f77bcf86cd799439012');

      const [, update] = collection.updateOne.mock.calls[0];
      // Membership, quizzes, schedules, and the invite code all survive intact:
      // unarchiving is meant to restore the course exactly as it was.
      expect(Object.keys(update.$set).sort()).toEqual([
        'archived',
        'archivedAt',
        'archivedBy',
        'updatedAt',
      ]);
      expect(update.$unset).toBeUndefined();
    });
  });

  describe('unarchiveCourse', () => {
    it('clears all three archive fields', async () => {
      await unarchiveCourse('507f1f77bcf86cd799439011');

      const [, update] = collection.updateOne.mock.calls[0];
      expect(Object.keys(update.$unset).sort()).toEqual([
        'archived',
        'archivedAt',
        'archivedBy',
      ]);
      expect(update.$set.courseCode).toBeUndefined();
    });

    it('applies a replacement course code when one is supplied', async () => {
      await unarchiveCourse('507f1f77bcf86cd799439011', 'chem-121-v-1');

      const [, update] = collection.updateOne.mock.calls[0];
      expect(update.$set.courseCode).toBe('chem-121-v-1');
    });
  });

  describe('listArchivedCoursesForOwner', () => {
    it('returns only archived courses the user owns, newest first', async () => {
      await listArchivedCoursesForOwner('507f1f77bcf86cd799439012');

      const filter = collection.find.mock.calls[0][0];
      expect(filter.archived).toBe(true);
      expect(filter.$or).toHaveLength(2);
      expect(cursor.sort).toHaveBeenCalledWith({ archivedAt: -1 });
    });

    it('returns an empty list rather than querying for a missing user', async () => {
      const result = await listArchivedCoursesForOwner(null);
      expect(result).toEqual([]);
      expect(collection.find).not.toHaveBeenCalled();
    });
  });
});
