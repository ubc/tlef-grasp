const {
  buildCalendarEvents,
  parseCalendarRange,
  windowStatus,
} = require('../../src/services/quiz-calendar');

const FROM = new Date('2026-07-01T00:00:00.000Z');
const TO = new Date('2026-08-01T00:00:00.000Z');
const NOW = new Date('2026-07-13T12:00:00.000Z');

describe('quiz calendar service', () => {
  describe('parseCalendarRange', () => {
    it('accepts an ascending range up to 370 days', () => {
      expect(parseCalendarRange(FROM.toISOString(), TO.toISOString())).toEqual({
        from: FROM,
        to: TO,
      });
    });

    it.each([
      ['invalid dates', 'not-a-date', TO.toISOString()],
      ['a reversed range', TO.toISOString(), FROM.toISOString()],
      ['an overlong range', FROM.toISOString(), '2027-08-01T00:00:00.000Z'],
    ])('rejects %s', (_label, from, to) => {
      expect(parseCalendarRange(from, to)).toHaveProperty('error');
    });
  });

  describe('windowStatus', () => {
    it.each([
      ['upcoming', '2026-07-14T00:00:00.000Z', '2026-07-20T00:00:00.000Z'],
      ['open', '2026-07-01T00:00:00.000Z', '2026-07-20T00:00:00.000Z'],
      ['expired', '2026-07-01T00:00:00.000Z', '2026-07-10T00:00:00.000Z'],
    ])('returns %s for the matching availability window', (expected, release, expire) => {
      expect(windowStatus(release, expire, NOW)).toBe(expected);
    });
  });

  it('deduplicates identical student windows, marks completion, and omits section details', () => {
    const quiz = { _id: 'quiz-1', name: 'Practice Quiz', published: true };
    const window = {
      releaseDate: '2026-07-10T16:00:00.000Z',
      expireDate: '2026-07-20T23:00:00.000Z',
    };
    const events = buildCalendarEvents({
      quizzes: [quiz],
      schedulesByQuiz: new Map([
        ['quiz-1', [
          { ...window, courseSectionId: 'section-1' },
          { ...window, courseSectionId: 'section-2' },
        ]],
      ]),
      completedQuizIds: ['quiz-1'],
      audience: 'student',
      from: FROM,
      to: TO,
      now: NOW,
    });

    expect(events).toHaveLength(3);
    expect(events.map((event) => event.type)).toEqual(['release', 'availability', 'deadline']);
    expect(events.every((event) => event.status === 'completed')).toBe(true);
    expect(events.every((event) => event.sectionId === undefined)).toBe(true);
  });

  it('keeps instructor section windows distinct and labels draft quizzes', () => {
    const events = buildCalendarEvents({
      quizzes: [{ _id: 'quiz-1', name: 'Practice Quiz', published: false }],
      schedulesByQuiz: new Map([
        ['quiz-1', [
          {
            courseSectionId: 'section-1',
            releaseDate: '2026-07-10T16:00:00.000Z',
            expireDate: '2026-07-20T23:00:00.000Z',
          },
          {
            courseSectionId: 'section-2',
            releaseDate: '2026-07-11T16:00:00.000Z',
            expireDate: '2026-07-21T23:00:00.000Z',
          },
        ]],
      ]),
      sectionsById: new Map([
        ['section-1', { sectionNumber: '001' }],
        ['section-2', { sectionId: 'LAB-2' }],
      ]),
      audience: 'instructor',
      from: FROM,
      to: TO,
      now: NOW,
    });

    expect(events).toHaveLength(4);
    expect(new Set(events.map((event) => event.sectionLabel))).toEqual(new Set(['001', 'LAB-2']));
    expect(events.every((event) => event.published === false)).toBe(true);
  });

  it('excludes release and deadline points outside the requested range', () => {
    const events = buildCalendarEvents({
      quizzes: [{ _id: 'quiz-1', name: 'Practice Quiz', published: true }],
      schedulesByQuiz: new Map([
        ['quiz-1', [{
          courseSectionId: 'section-1',
          releaseDate: '2026-06-20T16:00:00.000Z',
          expireDate: '2026-08-20T23:00:00.000Z',
        }]],
      ]),
      audience: 'instructor',
      from: FROM,
      to: TO,
      now: NOW,
    });

    expect(events).toEqual([]);
  });
});
