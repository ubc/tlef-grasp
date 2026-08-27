jest.mock('../../src/services/database', () => ({
  connect: jest.fn(),
}));

const databaseService = require('../../src/services/database');
const quizService = require('../../src/services/quiz');
const { ObjectId } = require('mongodb');

/**
 * The 3-phase selection asks "which quizzes came before this one?". Availability
 * moved to per-section schedule rows, so the answer differs per student: a quiz
 * created later can be released to a section first. These tests pin the phase 2
 * and phase 3 pools to the student's own release order.
 */

/** Loose equality that treats ObjectIds and their string forms as the same value. */
const same = (a, b) => {
  if (a === null || a === undefined || b === null || b === undefined) {
    return (a === null || a === undefined) && (b === null || b === undefined);
  }
  return a.toString() === b.toString();
};

const matches = (doc, filter = {}) =>
  Object.entries(filter).every(([key, expected]) => {
    const actual = doc[key];
    const isOperator =
      expected && typeof expected === 'object' && !Array.isArray(expected) &&
      !(expected instanceof ObjectId) && !(expected instanceof Date);
    if (isOperator && '$in' in expected) {
      return expected.$in.some((candidate) => same(actual, candidate));
    }
    if (isOperator && '$nin' in expected) {
      return !expected.$nin.some((candidate) => same(actual, candidate));
    }
    return same(actual, expected);
  });

/** Minimal in-memory Mongo double: find/findOne with $in, sort, project. */
const makeDb = (collections) => ({
  collection: (name) => {
    const docs = collections[name] || [];
    return {
      findOne: async (filter) => docs.find((doc) => matches(doc, filter)) || null,
      find: (filter) => {
        let result = docs.filter((doc) => matches(doc, filter));
        const cursor = {
          sort: (spec) => {
            const [[key, direction]] = Object.entries(spec);
            result = [...result].sort((a, b) => {
              const av = a[key] instanceof Date ? a[key].getTime() : a[key];
              const bv = b[key] instanceof Date ? b[key].getTime() : b[key];
              return (av < bv ? -1 : av > bv ? 1 : 0) * direction;
            });
            return cursor;
          },
          project: () => cursor,
          toArray: async () => result,
        };
        return cursor;
      },
    };
  },
});

const courseId = new ObjectId();
const userId = new ObjectId();
const loId = new ObjectId();
const sectionA = { _id: new ObjectId(), courseId, sectionId: 'A-101' };

// `Advanced` is the older document but this section reaches it last.
const advanced = {
  _id: new ObjectId(),
  courseId,
  name: 'Advanced',
  deliveryFormat: 'spaced-3phase',
  createdAt: new Date('2026-01-01T00:00:00Z'),
};
const foundations = {
  _id: new ObjectId(),
  courseId,
  name: 'Foundations',
  deliveryFormat: 'spaced-3phase',
  createdAt: new Date('2026-01-02T00:00:00Z'),
};

const foundationsQuestion = {
  _id: new ObjectId(),
  status: 'Approved',
  bloom: 'Understand',
  learningObjectiveId: loId,
  questionText: 'A question the student already saw in Foundations',
};

const seedDb = (masteryRecord) =>
  makeDb({
    grasp_quiz: [advanced, foundations],
    grasp_quiz_section_schedule: [
      {
        quizId: foundations._id,
        courseSectionId: sectionA._id,
        releaseDate: new Date('2026-02-01T00:00:00Z'),
        expireDate: new Date('2026-02-08T00:00:00Z'),
      },
      {
        quizId: advanced._id,
        courseSectionId: sectionA._id,
        releaseDate: new Date('2026-04-01T00:00:00Z'),
        expireDate: new Date('2026-04-08T00:00:00Z'),
      },
    ],
    grasp_course_section: [sectionA],
    grasp_user_course_section: [{ userId, courseId, sectionId: 'A-101' }],
    grasp_quiz_question: [{ quizId: foundations._id, questionId: foundationsQuestion._id }],
    grasp_question: [foundationsQuestion],
    grasp_student_performance: [masteryRecord],
    grasp_student_attempt: [],
    grasp_objective: [],
  });

describe('phase selection uses the student per-section release order', () => {
  it('remediates an LO failed in a quiz released earlier but created later', async () => {
    databaseService.connect.mockResolvedValue(
      seedDb({
        userId,
        courseId,
        learningObjectiveId: loId,
        needsRemediation: true,
        remediationBloomLevel: 'Understand',
      })
    );

    const selected = await quizService.getPhase2Questions(advanced._id, userId);

    expect(selected.map((q) => q._id.toString())).toEqual([foundationsQuestion._id.toString()]);
  });

  it('spaced-reviews an LO mastered in a quiz released earlier but created later', async () => {
    databaseService.connect.mockResolvedValue(
      seedDb({
        userId,
        courseId,
        learningObjectiveId: loId,
        needsRemediation: false,
        timesCorrect: 1,
        highestBloomPassed: 'Remember',
      })
    );

    const selected = await quizService.getPhase3Questions(advanced._id, userId);

    expect(selected.map((q) => q._id.toString())).toEqual([foundationsQuestion._id.toString()]);
  });

  it('treats the section first quiz as having no history', async () => {
    databaseService.connect.mockResolvedValue(
      seedDb({
        userId,
        courseId,
        learningObjectiveId: loId,
        needsRemediation: true,
        remediationBloomLevel: 'Understand',
      })
    );

    // Foundations is first for this section, so nothing precedes it — even
    // though `Advanced` is the older document.
    await expect(quizService.getPhase2Questions(foundations._id, userId)).resolves.toEqual([]);
    await expect(quizService.getPhase3Questions(foundations._id, userId)).resolves.toEqual([]);
  });
});
