// GRASP's record of a quiz's LMS assignments (src/services/quiz-lms-assignment.js):
// the claim that stops two requests creating the same assignment, and what a
// decline may and may not overwrite. Runs against an in-memory stand-in for the
// collection that enforces the unique (quizId, courseSectionId) index.
jest.mock('../../src/services/database', () => ({ connect: jest.fn() }));

const { ObjectId } = require('mongodb');
const databaseService = require('../../src/services/database');
const service = require('../../src/services/quiz-lms-assignment');

const QUIZ_ID = new ObjectId().toHexString();
const SECTION_ID = new ObjectId().toHexString();
const COURSE_ID = new ObjectId().toHexString();
const USER_ID = new ObjectId().toHexString();

const claimInput = {
  quizId: QUIZ_ID,
  courseSectionId: SECTION_ID,
  courseId: COURSE_ID,
  provider: 'canvas',
  instance: 'https://canvas.example.test',
  externalCourseId: '42',
  externalSectionId: '501',
  userId: USER_ID,
};

// Just enough of a Mongo collection for the service: a unique index on
// (quizId, courseSectionId), status filters, $set/$unset/$setOnInsert.
function fakeCollection() {
  const docs = [];
  const eq = (a, b) => String(a) === String(b);
  const matches = (doc, filter) =>
    Object.entries(filter).every(([key, value]) => {
      if (value && typeof value === 'object' && !(value instanceof Date) && !(value instanceof ObjectId)) {
        if ('$ne' in value) return !eq(doc[key], value.$ne);
        if ('$in' in value) return value.$in.some((v) => eq(doc[key], v));
      }
      if (value instanceof Date) return doc[key] instanceof Date && doc[key].getTime() === value.getTime();
      return eq(doc[key], value);
    });
  const apply = (doc, update) => {
    Object.assign(doc, update.$set || {});
    for (const key of Object.keys(update.$unset || {})) delete doc[key];
  };
  const duplicate = (doc) =>
    docs.some((d) => eq(d.quizId, doc.quizId) && eq(d.courseSectionId, doc.courseSectionId));

  return {
    docs,
    insertOne: jest.fn(async (doc) => {
      if (duplicate(doc)) throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
      const stored = { _id: new ObjectId(), ...doc };
      docs.push(stored);
      return { insertedId: stored._id };
    }),
    findOne: jest.fn(async (filter) => docs.find((d) => matches(d, filter)) || null),
    find: jest.fn((filter) => ({ toArray: async () => docs.filter((d) => matches(d, filter)) })),
    findOneAndUpdate: jest.fn(async (filter, update) => {
      const doc = docs.find((d) => matches(d, filter));
      if (!doc) return null;
      apply(doc, update);
      return doc;
    }),
    updateOne: jest.fn(async (filter, update, options = {}) => {
      const doc = docs.find((d) => matches(d, filter));
      if (doc) {
        apply(doc, update);
        return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
      }
      if (!options.upsert) return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
      const inserted = { ...filter, ...(update.$setOnInsert || {}), ...(update.$set || {}) };
      for (const key of Object.keys(inserted)) {
        if (inserted[key] && typeof inserted[key] === 'object' && ('$ne' in inserted[key] || '$in' in inserted[key])) delete inserted[key];
      }
      if (duplicate(inserted)) throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
      docs.push({ _id: new ObjectId(), ...inserted });
      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
    }),
    deleteOne: jest.fn(async (filter) => {
      const index = docs.findIndex((d) => matches(d, filter));
      if (index >= 0) docs.splice(index, 1);
      return { deletedCount: index >= 0 ? 1 : 0 };
    }),
    deleteMany: jest.fn(async (filter) => {
      const before = docs.length;
      for (let i = docs.length - 1; i >= 0; i--) if (matches(docs[i], filter)) docs.splice(i, 1);
      return { deletedCount: before - docs.length };
    }),
  };
}

describe('quiz LMS assignment rows', () => {
  let collection;

  beforeEach(() => {
    collection = fakeCollection();
    databaseService.connect.mockResolvedValue({
      collection: jest.fn((name) => {
        if (name === service.COLLECTION) return collection;
        throw new Error(`Unexpected collection: ${name}`);
      }),
    });
  });

  describe('claimRow', () => {
    it('inserts a pending row with where the assignment will live', async () => {
      const claim = await service.claimRow(claimInput);

      expect(claim.previousStatus).toBeNull();
      expect(collection.docs).toHaveLength(1);
      expect(collection.docs[0]).toEqual(expect.objectContaining({
        quizId: new ObjectId(QUIZ_ID),
        courseSectionId: new ObjectId(SECTION_ID),
        courseId: new ObjectId(COURSE_ID),
        provider: 'canvas',
        instance: 'https://canvas.example.test',
        externalCourseId: '42',
        externalSectionId: '501',
        status: 'pending',
        createdBy: new ObjectId(USER_ID),
      }));
      expect(claim.row._id).toEqual(collection.docs[0]._id);
    });

    it('refuses while another request holds a live claim', async () => {
      await service.claimRow(claimInput);

      expect(await service.claimRow(claimInput)).toBeNull();
      expect(collection.docs).toHaveLength(1);
    });

    it('refuses once the assignment exists', async () => {
      const first = await service.claimRow(claimInput);
      await service.markCreated(first.row._id, { externalAssignmentId: 9001, externalOverrideId: 77, name: 'Quiz 1 — 101 (GRASP)', htmlUrl: null, dueAt: new Date() });

      expect(await service.claimRow(claimInput)).toBeNull();
      expect(collection.docs[0].status).toBe('created');
    });

    it('takes over a decline, remembering it was one', async () => {
      await service.markDeclined({ ...claimInput, courseSectionIds: [SECTION_ID] });

      const claim = await service.claimRow(claimInput);

      expect(claim.previousStatus).toBe('declined');
      expect(collection.docs).toHaveLength(1);
      expect(collection.docs[0].status).toBe('pending');
    });

    it('takes over a claim whose request died', async () => {
      const dead = await service.claimRow(claimInput);
      collection.docs[0].updatedAt = new Date(Date.now() - service.CLAIM_TTL_MS - 1000);

      const claim = await service.claimRow(claimInput);

      expect(claim.previousStatus).toBe('pending');
      expect(claim.row._id).toEqual(dead.row._id);
      expect(collection.docs[0].updatedAt.getTime()).toBeGreaterThan(Date.now() - 5000);
    });
  });

  describe('releaseClaim', () => {
    it('removes a fresh claim whose create failed', async () => {
      const claim = await service.claimRow(claimInput);

      await service.releaseClaim(claim.row, null, new Error('Canvas 502'));

      expect(collection.docs).toHaveLength(0);
    });

    it('puts a decline back when the create that replaced it failed', async () => {
      await service.markDeclined({ ...claimInput, courseSectionIds: [SECTION_ID] });
      const claim = await service.claimRow(claimInput);

      await service.releaseClaim(claim.row, 'declined', new Error('Canvas 502'));

      expect(collection.docs[0].status).toBe('declined');
      expect(collection.docs[0].lastError.message).toBe('Canvas 502');
    });

    it('does not undo a claim that was completed in the meantime', async () => {
      const claim = await service.claimRow(claimInput);
      await service.markCreated(claim.row._id, { externalAssignmentId: 9001, externalOverrideId: 77, name: 'n', htmlUrl: null, dueAt: new Date() });

      await service.releaseClaim(claim.row, null, new Error('late failure'));

      expect(collection.docs).toHaveLength(1);
      expect(collection.docs[0].status).toBe('created');
    });
  });

  describe('markDeclined', () => {
    it('records a decline for each section, once', async () => {
      const declined = await service.markDeclined({ ...claimInput, courseSectionIds: [SECTION_ID, SECTION_ID] });

      expect(declined).toEqual([SECTION_ID, SECTION_ID]);
      expect(collection.docs).toHaveLength(1);
      expect(collection.docs[0]).toEqual(expect.objectContaining({ status: 'declined', createdBy: new ObjectId(USER_ID) }));
    });

    it('never overwrites an existing assignment', async () => {
      const claim = await service.claimRow(claimInput);
      await service.markCreated(claim.row._id, { externalAssignmentId: 9001, externalOverrideId: 77, name: 'n', htmlUrl: null, dueAt: new Date() });

      const declined = await service.markDeclined({ ...claimInput, courseSectionIds: [SECTION_ID] });

      expect(declined).toEqual([]);
      expect(collection.docs[0].status).toBe('created');
    });
  });

  describe('sync bookkeeping', () => {
    it('markSynced stores the due date and override and clears the last error', async () => {
      const claim = await service.claimRow(claimInput);
      await service.markCreated(claim.row._id, { externalAssignmentId: 9001, externalOverrideId: null, name: 'n', htmlUrl: null, dueAt: new Date('2026-10-01T00:00:00Z') });
      await service.markSyncFailed(claim.row._id, new Error('Canvas was down'));
      expect(collection.docs[0].lastError.message).toBe('Canvas was down');

      const dueAt = new Date('2026-11-01T06:59:00Z');
      await service.markSynced(claim.row._id, { dueAt, externalOverrideId: 78 });

      expect(collection.docs[0]).toEqual(expect.objectContaining({ dueAt, externalOverrideId: '78' }));
      expect(collection.docs[0]).not.toHaveProperty('lastError');
    });
  });

  describe('reading and cleanup', () => {
    it('keys rows by section for a quiz and by quiz for a section', async () => {
      const claim = await service.claimRow(claimInput);

      expect((await service.getRowsForQuiz(QUIZ_ID)).get(SECTION_ID)._id).toEqual(claim.row._id);
      expect((await service.getRowsForSection(SECTION_ID)).get(QUIZ_ID)._id).toEqual(claim.row._id);
    });

    it('removes a quiz\'s or a section\'s rows', async () => {
      await service.claimRow(claimInput);
      await service.claimRow({ ...claimInput, courseSectionId: new ObjectId().toHexString() });

      await service.removeForSection(SECTION_ID);
      expect(collection.docs).toHaveLength(1);
      await service.removeForQuiz(QUIZ_ID);
      expect(collection.docs).toHaveLength(0);
    });
  });

  describe('publicAssignment', () => {
    it('hides pending claims, and reports declines and created assignments', () => {
      expect(service.publicAssignment(undefined)).toBeNull();
      expect(service.publicAssignment({ status: 'pending' })).toBeNull();
      expect(service.publicAssignment({ status: 'declined' })).toEqual({ status: 'declined', lastError: null });
      const at = new Date();
      expect(service.publicAssignment({
        status: 'created', externalAssignmentId: 9001, name: 'n', htmlUrl: 'u', dueAt: at, syncedAt: at,
        lastError: { message: 'm', at, stack: 'never shown' },
      })).toEqual({
        status: 'created', externalAssignmentId: '9001', name: 'n', htmlUrl: 'u', dueAt: at, syncedAt: at,
        lastError: { message: 'm', at },
      });
    });
  });
});
