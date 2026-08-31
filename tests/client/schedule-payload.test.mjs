import { describe, it, expect } from '@jest/globals';
import {
  applyScheduleWindow,
  schedulesWithout,
  sectionPickerOptions,
} from '../../client/src/pages/quizzes/schedulePayload.js';

// Stored rows come back from the API with ISO strings.
const row = (courseSectionId, release, expire) => ({
  courseSectionId,
  releaseDate: `${release}T00:00:00.000Z`,
  expireDate: `${expire}T00:00:00.000Z`,
});

const section = (id, sectionNumber) => ({ _id: id, sectionId: `SEC-${id}`, sectionNumber });

const WINDOW = { releaseDate: '2026-09-01T09:00', expireDate: '2026-09-30T23:59' };

const byId = (rows) => Object.fromEntries(rows.map((r) => [r.courseSectionId, r]));

describe('applyScheduleWindow', () => {
  // The point of the bulk path: one window, several sections, one save.
  it('writes the same window to every selected section', () => {
    const payload = applyScheduleWindow([], { courseSectionIds: ['s2', 's5'], ...WINDOW });

    expect(payload).toEqual([
      { courseSectionId: 's2', ...WINDOW },
      { courseSectionId: 's5', ...WINDOW },
    ]);
  });

  // The endpoint replaces the instructor's whole set, so an untouched section
  // must be resent verbatim or scheduling 005 would unschedule 002.
  it('resends untouched sections with their stored dates', () => {
    const existing = [row('s2', '2026-01-01', '2026-02-01')];

    const payload = applyScheduleWindow(existing, { courseSectionIds: ['s5'], ...WINDOW });

    expect(payload).toHaveLength(2);
    expect(byId(payload).s2).toEqual(existing[0]);
    expect(byId(payload).s5).toEqual({ courseSectionId: 's5', ...WINDOW });
  });

  it('overwrites a selected section that was already scheduled', () => {
    const existing = [row('s2', '2026-01-01', '2026-02-01'), row('s5', '2026-03-01', '2026-04-01')];

    const payload = applyScheduleWindow(existing, {
      courseSectionIds: ['s2', 's5'],
      ...WINDOW,
    });

    expect(payload).toHaveLength(2);
    expect(byId(payload).s2).toEqual({ courseSectionId: 's2', ...WINDOW });
    expect(byId(payload).s5).toEqual({ courseSectionId: 's5', ...WINDOW });
  });

  it('leaves the set unchanged when nothing is selected', () => {
    const existing = [row('s2', '2026-01-01', '2026-02-01')];

    expect(applyScheduleWindow(existing, { courseSectionIds: [], ...WINDOW })).toEqual(existing);
  });
});

describe('schedulesWithout', () => {
  // Removing one section's window is the same replace, minus that row.
  it('drops the named sections and keeps the rest', () => {
    const existing = [row('s2', '2026-01-01', '2026-02-01'), row('s5', '2026-03-01', '2026-04-01')];

    expect(schedulesWithout(existing, ['s2'])).toEqual([existing[1]]);
  });
});

describe('sectionPickerOptions', () => {
  // Scheduled sections stay in the list — that is what lets one window be
  // re-applied across a partly scheduled course.
  it('offers every owned section and marks the scheduled ones', () => {
    const options = sectionPickerOptions(
      [section('s2', '002'), section('s5', '005')],
      [row('s2', '2026-01-01', '2026-02-01')]
    );

    expect(options).toEqual([
      { value: 's2', label: '002', hint: 'Scheduled' },
      { value: 's5', label: '005', hint: undefined },
    ]);
  });

  it('falls back to the section id when there is no section number', () => {
    expect(sectionPickerOptions([section('s9', null)], [])[0].label).toBe('SEC-s9');
  });
});
