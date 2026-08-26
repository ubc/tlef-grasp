jest.mock('../../src/services/database', () => ({
  connect: jest.fn(),
}));

const quizScheduleService = require('../../src/services/quiz-schedule');
const { ObjectId } = require('mongodb');

/**
 * Ordering a course's quizzes the way one student actually experienced them.
 *
 * Availability lives in grasp_quiz_section_schedule (per section), so creation
 * order is not teaching order: two sections running at different paces get the
 * same quizzes released in different sequences.
 */
describe('orderQuizzesForStudent', () => {
  const sectionA = new ObjectId();
  const sectionB = new ObjectId();

  const quiz = (name, createdAt) => ({
    _id: new ObjectId(),
    name,
    createdAt: new Date(createdAt),
  });

  it('orders by the release date for the student section, not by creation order', () => {
    const midterm = quiz('Midterm', '2026-01-01T00:00:00Z');
    const warmup = quiz('Warmup', '2026-01-02T00:00:00Z');

    // Warmup was created second but this section sees it first.
    const schedules = new Map([
      [midterm._id.toString(), [
        { courseSectionId: sectionA.toString(), releaseDate: new Date('2026-03-01T00:00:00Z'), expireDate: new Date('2026-03-08T00:00:00Z') },
      ]],
      [warmup._id.toString(), [
        { courseSectionId: sectionA.toString(), releaseDate: new Date('2026-02-01T00:00:00Z'), expireDate: new Date('2026-02-08T00:00:00Z') },
      ]],
    ]);

    const ordered = quizScheduleService.orderQuizzesForStudent(
      [midterm, warmup],
      schedules,
      [sectionA.toString()]
    );

    expect(ordered.map((q) => q.name)).toEqual(['Warmup', 'Midterm']);
  });

  it('gives two sections different orderings of the same quizzes', () => {
    const first = quiz('Created first', '2026-01-01T00:00:00Z');
    const second = quiz('Created second', '2026-01-02T00:00:00Z');

    const rows = (aRelease, bRelease) => ([
      { courseSectionId: sectionA.toString(), releaseDate: new Date(aRelease), expireDate: new Date('2027-01-01T00:00:00Z') },
      { courseSectionId: sectionB.toString(), releaseDate: new Date(bRelease), expireDate: new Date('2027-01-01T00:00:00Z') },
    ]);

    const schedules = new Map([
      [first._id.toString(), rows('2026-02-01T00:00:00Z', '2026-03-01T00:00:00Z')],
      [second._id.toString(), rows('2026-02-15T00:00:00Z', '2026-02-10T00:00:00Z')],
    ]);

    const forA = quizScheduleService.orderQuizzesForStudent([first, second], schedules, [sectionA.toString()]);
    const forB = quizScheduleService.orderQuizzesForStudent([first, second], schedules, [sectionB.toString()]);

    expect(forA.map((q) => q.name)).toEqual(['Created first', 'Created second']);
    expect(forB.map((q) => q.name)).toEqual(['Created second', 'Created first']);
  });

  it('falls back to creation order for quizzes the student has no schedule row for', () => {
    const unscheduled = quiz('Unscheduled', '2026-01-01T00:00:00Z');
    const scheduled = quiz('Scheduled', '2026-01-02T00:00:00Z');

    const schedules = new Map([
      [scheduled._id.toString(), [
        { courseSectionId: sectionA.toString(), releaseDate: new Date('2026-02-01T00:00:00Z'), expireDate: new Date('2026-02-08T00:00:00Z') },
      ]],
      // `unscheduled` is scheduled only for a section this student is not in.
      [unscheduled._id.toString(), [
        { courseSectionId: sectionB.toString(), releaseDate: new Date('2026-01-15T00:00:00Z'), expireDate: new Date('2026-01-20T00:00:00Z') },
      ]],
    ]);

    const ordered = quizScheduleService.orderQuizzesForStudent(
      [unscheduled, scheduled],
      schedules,
      [sectionA.toString()]
    );

    expect(ordered.map((q) => q.name)).toEqual(['Unscheduled', 'Scheduled']);
  });

  it('uses the earliest of the student section release dates when they are in several', () => {
    const early = quiz('Early', '2026-01-02T00:00:00Z');
    const late = quiz('Late', '2026-01-01T00:00:00Z');

    const schedules = new Map([
      [early._id.toString(), [
        { courseSectionId: sectionB.toString(), releaseDate: new Date('2026-05-01T00:00:00Z'), expireDate: new Date('2026-05-08T00:00:00Z') },
        { courseSectionId: sectionA.toString(), releaseDate: new Date('2026-02-01T00:00:00Z'), expireDate: new Date('2026-02-08T00:00:00Z') },
      ]],
      [late._id.toString(), [
        { courseSectionId: sectionA.toString(), releaseDate: new Date('2026-03-01T00:00:00Z'), expireDate: new Date('2026-03-08T00:00:00Z') },
      ]],
    ]);

    const ordered = quizScheduleService.orderQuizzesForStudent(
      [late, early],
      schedules,
      [sectionA.toString(), sectionB.toString()]
    );

    expect(ordered.map((q) => q.name)).toEqual(['Early', 'Late']);
  });

  it('keeps creation order when the caller has no sections at all (instructor preview)', () => {
    const first = quiz('First', '2026-01-01T00:00:00Z');
    const second = quiz('Second', '2026-01-02T00:00:00Z');

    const ordered = quizScheduleService.orderQuizzesForStudent(
      [first, second],
      new Map(),
      []
    );

    expect(ordered.map((q) => q.name)).toEqual(['First', 'Second']);
  });
});
