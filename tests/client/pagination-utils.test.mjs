import { describe, expect, it } from "@jest/globals";
import {
  NARROW_SIBLINGS,
  WIDE_SIBLINGS,
  visiblePages,
} from "../../client/src/components/ui/paginationUtils.js";

describe("visiblePages", () => {
  it("returns the single page when there is only one", () => {
    expect(visiblePages(1, 1, WIDE_SIBLINGS)).toEqual([1]);
  });

  it("shows every page when the range fits without collapsing", () => {
    expect(visiblePages(3, 5, WIDE_SIBLINGS)).toEqual([1, 2, 3, 4, 5]);
    expect(visiblePages(4, 7, WIDE_SIBLINGS)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("keeps first, last, and a window around the current page over 80 pages", () => {
    expect(visiblePages(1, 80, WIDE_SIBLINGS)).toEqual([1, 2, 3, 80]);
    expect(visiblePages(40, 80, WIDE_SIBLINGS)).toEqual([1, 38, 39, 40, 41, 42, 80]);
    expect(visiblePages(80, 80, WIDE_SIBLINGS)).toEqual([1, 78, 79, 80]);
  });

  it("never exceeds seven numbers at the wide window", () => {
    for (let currentPage = 1; currentPage <= 80; currentPage += 1) {
      expect(visiblePages(currentPage, 80, WIDE_SIBLINGS).length).toBeLessThanOrEqual(7);
    }
  });

  it("narrows to a single sibling on small screens", () => {
    expect(visiblePages(1, 80, NARROW_SIBLINGS)).toEqual([1, 2, 80]);
    expect(visiblePages(40, 80, NARROW_SIBLINGS)).toEqual([1, 39, 40, 41, 80]);
    expect(visiblePages(80, 80, NARROW_SIBLINGS)).toEqual([1, 79, 80]);
  });

  it("never exceeds five numbers at the narrow window", () => {
    for (let currentPage = 1; currentPage <= 80; currentPage += 1) {
      expect(
        visiblePages(currentPage, 80, NARROW_SIBLINGS).length,
      ).toBeLessThanOrEqual(5);
    }
  });

  it("still shows five pages uncollapsed at the narrow window", () => {
    expect(visiblePages(3, 5, NARROW_SIBLINGS)).toEqual([1, 2, 3, 4, 5]);
  });

  it("always includes the current page so the active button is rendered", () => {
    for (const siblings of [NARROW_SIBLINGS, WIDE_SIBLINGS]) {
      for (let currentPage = 1; currentPage <= 80; currentPage += 1) {
        expect(visiblePages(currentPage, 80, siblings)).toContain(currentPage);
      }
    }
  });
});
