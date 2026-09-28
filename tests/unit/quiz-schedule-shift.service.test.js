jest.mock('../../src/services/database', () => ({
  connect: jest.fn(),
}));

const databaseService = require('../../src/services/database');
const { shiftDate, planShift, shiftSchedules } = require('../../src/services/quiz-schedule');
const { ObjectId } = require('mongodb');

const VANCOUVER = 'America/Vancouver';

describe('shiftDate', () => {
  it('keeps wall-clock time when a day shift crosses a DST boundary', () => {
    // 23:59 PDT on Oct 30 → 23:59 PST on Nov 6 (clocks fall back Nov 1).
    const shifted = shiftDate('2026-10-31T06:59:00Z', { days: 7 }, VANCOUVER);
    expect(shifted.toISOString()).toBe('2026-11-07T07:59:00.000Z');
  });

  it('shifts backwards across spring-forward as well', () => {
    // 09:00 PDT Mar 10 → 09:00 PST Mar 3 (clocks spring forward Mar 8).
    const shifted = shiftDate('2026-03-10T16:00:00Z', { days: -7 }, VANCOUVER);
    expect(shifted.toISOString()).toBe('2026-03-03T17:00:00.000Z');
  });

  it('treats hour offsets as absolute time', () => {
    const shifted = shiftDate('2026-10-31T06:59:00Z', { minutes: 7 * 24 * 60 }, VANCOUVER);
    expect(shifted.toISOString()).toBe('2026-11-07T06:59:00.000Z');
  });
});

describe('planShift', () => {
  const section = new ObjectId();
  const now = new Date('2026-09-15T00:00:00Z');
  const row = (release, expire) => ({
    _id: new ObjectId(),
    quizId: new ObjectId(),
    courseSectionId: section,
    releaseDate: new Date(release),
    expireDate: new Date(expire),
  });

  it('flags windows that close in the past or open immediately', () => {
    const [closed, opens] = planShift(
      [
        row('2026-09-10T00:00:00Z', '2026-09-20T00:00:00Z'),
        row('2026-09-20T00:00:00Z', '2026-09-30T00:00:00Z'),
      ],
      { days: -7 },
      { now }
    );
    expect(closed.flags).toEqual(['expired']);
    expect(opens.flags).toEqual(['opens-now']);
  });

  it('flags a collision with another quiz starting at the same moment in the same section', () => {
    const other = { quizId: new ObjectId(), courseSectionId: section, releaseDate: new Date('2026-10-08T00:00:00Z') };
    const [p] = planShift([row('2026-10-01T00:00:00Z', '2026-10-05T00:00:00Z')], { days: 7 }, { now, otherRows: [other] });
    expect(p.flags).toEqual(['collision']);
  });
});

describe('shiftSchedules', () => {
  const section = new ObjectId();
  const quizIds = [new ObjectId(), new ObjectId()];
  let rows;
  let collection;

  beforeEach(() => {
    rows = quizIds.map((quizId) => ({
      _id: new ObjectId(),
      quizId,
      courseSectionId: section,
      releaseDate: new Date('2026-10-01T00:00:00Z'),
      expireDate: new Date('2026-10-05T00:00:00Z'),
    }));
    collection = {
      find: jest.fn((filter) => ({ toArray: async () => (filter.quizId.$in ? rows : []) })),
      updateOne: jest.fn(async () => ({ matchedCount: 1 })),
    };
    databaseService.connect.mockResolvedValue({ collection: () => collection });
  });

  const run = (opts = {}) =>
    shiftSchedules(quizIds.map(String), { days: 7 }, { restrictToSectionIds: [section.toString()], ...opts });

  it('only reads rows in the permitted sections', async () => {
    await run({ dryRun: true });
    expect(collection.find.mock.calls[0][0].courseSectionId).toEqual({ $in: [section] });
  });

  it('writes nothing on a dry run', async () => {
    const plan = await run({ dryRun: true });
    expect(plan).toHaveLength(2);
    expect(collection.updateOne).not.toHaveBeenCalled();
  });

  it('rolls back already-moved rows when a later row fails', async () => {
    collection.updateOne
      .mockResolvedValueOnce({ matchedCount: 1 })
      .mockResolvedValueOnce({ matchedCount: 0 }) // row changed underneath us
      .mockResolvedValue({ matchedCount: 1 });

    await expect(run()).rejects.toMatchObject({ status: 409 });

    expect(collection.updateOne).toHaveBeenCalledTimes(3);
    const [filter, update] = collection.updateOne.mock.calls[2];
    expect(filter._id).toBe(rows[0]._id);
    expect(update.$set.releaseDate).toEqual(rows[0].releaseDate);
    expect(update.$set.expireDate).toEqual(rows[0].expireDate);
  });
});
