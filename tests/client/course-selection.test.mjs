// The sidebar's selection rule, which archiving made non-obvious: archived
// courses are deliberately absent from /api/courses/my, so the old "is the
// selection still in the list?" check would eject an owner the moment they
// opened an archived course from the Manage-courses hub.

import { describe, it, expect } from '@jest/globals';
import { resolveCourseSelection } from '../../client/src/lib/courseSelection.js';

const live = (id) => ({ id, name: `Live ${id}` });
const archived = (id) => ({ id, name: `Archived ${id}` });

describe('resolveCourseSelection', () => {
  it('keeps a selection that is still a live course', () => {
    const result = resolveCourseSelection({
      selectedCourse: { id: 'a' },
      courses: [live('a'), live('b')],
      archivedCourses: [],
    });

    expect(result).toEqual({ action: 'keep', isArchived: false });
  });

  it('keeps an archived selection and flags it as archived', () => {
    // The owner opened this from the hub. It is absent from `courses` by
    // design, and ejecting them here would make the Archived tab useless.
    const result = resolveCourseSelection({
      selectedCourse: { id: 'z' },
      courses: [live('a')],
      archivedCourses: [archived('z')],
    });

    expect(result).toEqual({ action: 'keep', isArchived: true });
  });

  it('keeps an archived selection even when no live course remains', () => {
    // An instructor who has archived every course they own is still entitled
    // to sit inside one and read it.
    const result = resolveCourseSelection({
      selectedCourse: { id: 'z' },
      courses: [],
      archivedCourses: [archived('z')],
    });

    expect(result).toEqual({ action: 'keep', isArchived: true });
  });

  it('switches to the first live course when the selection is gone', () => {
    const result = resolveCourseSelection({
      selectedCourse: { id: 'deleted' },
      courses: [live('a'), live('b')],
      archivedCourses: [archived('z')],
    });

    expect(result.action).toBe('switch');
    expect(result.course.id).toBe('a');
  });

  it('picks a course when nothing is selected yet', () => {
    const result = resolveCourseSelection({
      selectedCourse: null,
      courses: [live('a')],
      archivedCourses: [],
    });

    expect(result.action).toBe('switch');
    expect(result.course.id).toBe('a');
  });

  it('clears a stale selection when nothing is reachable', () => {
    const result = resolveCourseSelection({
      selectedCourse: { id: 'deleted' },
      courses: [],
      archivedCourses: [],
    });

    expect(result).toEqual({ action: 'clear', isArchived: false });
  });

  it('does nothing when there is nothing selected and nothing to select', () => {
    // "clear" would be a redundant store write on every render.
    const result = resolveCourseSelection({
      selectedCourse: null,
      courses: [],
      archivedCourses: [],
    });

    expect(result.action).toBe('keep');
  });

  it('defaults both lists so a still-loading hook cannot crash it', () => {
    const result = resolveCourseSelection({ selectedCourse: null });
    expect(result.action).toBe('keep');
  });
});
