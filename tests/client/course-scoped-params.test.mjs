// Page state is thrown away on a course switch by re-keying the router outlet
// (AppLayout), but query-string filters live in the URL and survive that
// remount. The ones carrying an id — a quiz, an objective, a material — name a
// row of the course being left, so the new course filters against something it
// has never heard of and the list comes back empty.

import { describe, it, expect } from '@jest/globals';
import { stripCourseScopedParams } from '../../client/src/lib/courseScopedParams.js';

describe('stripCourseScopedParams', () => {
  it('returns null when there is nothing course-scoped to strip', () => {
    // null, not "": the caller skips the navigate entirely rather than
    // pushing a history entry identical to the current one.
    expect(stripCourseScopedParams('?tab=objectives&status=Draft')).toBeNull();
    expect(stripCourseScopedParams('')).toBeNull();
  });

  it('drops a quiz filter pointing at the course being left', () => {
    expect(stripCourseScopedParams('?quiz=abc123')).toBe('');
  });

  it('drops objective and material filters too', () => {
    expect(stripCourseScopedParams('?objective=o1')).toBe('');
    expect(stripCourseScopedParams('?material=m1')).toBe('');
  });

  it('keeps filters that mean the same thing in any course', () => {
    // Bloom level, status, flagged and the search box are plain values, not
    // ids — carrying them across is the behaviour a user would expect.
    const result = stripCourseScopedParams(
      '?quiz=abc123&bloom=Apply&status=Draft&flagged=true&q=photosynthesis'
    );

    expect(new URLSearchParams(result).get('quiz')).toBeNull();
    expect(new URLSearchParams(result).get('bloom')).toBe('Apply');
    expect(new URLSearchParams(result).get('status')).toBe('Draft');
    expect(new URLSearchParams(result).get('flagged')).toBe('true');
    expect(new URLSearchParams(result).get('q')).toBe('photosynthesis');
  });

  it('keeps the tab so a switch leaves the user where they were looking', () => {
    expect(stripCourseScopedParams('?tab=objectives&material=m1')).toBe('?tab=objectives');
  });

  it('strips every course-scoped param at once', () => {
    expect(stripCourseScopedParams('?quiz=q1&objective=o1&material=m1')).toBe('');
  });

  it('accepts a leading "?" or not', () => {
    expect(stripCourseScopedParams('quiz=q1&bloom=Apply')).toBe('?bloom=Apply');
  });
});
