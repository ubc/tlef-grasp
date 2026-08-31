// The course switcher exists to tell two shells of the same course apart, so
// what a label does when half the information is missing matters more than the
// happy path: a course with no sections yet has no academic period, and most
// courses have no nickname. Neither may leave a dangling separator behind.

import { describe, it, expect } from '@jest/globals';
import {
  courseLabel,
  periodLabel,
  prettyPeriod,
  formatPeriodCode,
} from '../../client/src/lib/academicPeriod.js';

describe('courseLabel', () => {
  it('is the bare course name when there is nothing to disambiguate', () => {
    expect(courseLabel({ courseName: 'Intro Stats' })).toBe('Intro Stats');
    expect(courseLabel({ name: 'Intro Stats' })).toBe('Intro Stats');
  });

  it('adds a nickname on its own', () => {
    expect(courseLabel({ courseName: 'Intro Stats', nickname: 'Tuesday cohort' })).toBe(
      'Intro Stats (Tuesday cohort)'
    );
  });

  it('adds a period on its own', () => {
    expect(courseLabel({ courseName: 'Intro Stats', academicPeriod: '2025W1' })).toBe(
      'Intro Stats — 2025 Winter1'
    );
  });

  it('adds both when both are known', () => {
    expect(
      courseLabel({
        courseName: 'Intro Stats',
        nickname: 'Tuesday cohort',
        academicPeriodName: '2025 Winter Term 1',
      })
    ).toBe('Intro Stats (Tuesday cohort) — 2025 Winter Term 1');
  });

  it('treats a whitespace-only nickname as absent', () => {
    expect(courseLabel({ courseName: 'Intro Stats', nickname: '   ' })).toBe('Intro Stats');
  });

  it('always leads with the course name, so students still recognise it', () => {
    // A nickname disambiguates the shell; it does not rename the course.
    const label = courseLabel({ courseName: 'Introduction to Statistics', nickname: 'S2' });
    expect(label.startsWith('Introduction to Statistics')).toBe(true);
  });
});

describe('periodLabel', () => {
  it('prefers the name the API supplied over the derived code', () => {
    expect(
      periodLabel({ academicPeriod: '2025W1', academicPeriodName: 'Winter Session Term 1' })
    ).toBe('Winter Session Term 1');
  });

  it('decodes winter and summer session codes', () => {
    expect(formatPeriodCode('2025W2')).toBe('2025 Winter2');
    expect(formatPeriodCode('2024S1')).toBe('2024 Summer1');
  });

  it('passes an unrecognised code through rather than swallowing it', () => {
    expect(periodLabel({ academicPeriod: '2025X9' })).toBe('2025X9');
  });

  it('yields "" where prettyPeriod yields "Unknown"', () => {
    // The switcher omits an unknown period; the sections table must not render
    // a blank cell that reads as a rendering bug.
    expect(periodLabel({})).toBe('');
    expect(prettyPeriod({})).toBe('Unknown');
  });
});
