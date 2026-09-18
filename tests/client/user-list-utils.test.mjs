import { describe, expect, it } from "@jest/globals";
import {
  describeAccessEvent,
  describeMembershipSource,
  filterAndSortCourseUsers,
  getUserNames,
  personLabel,
} from "../../client/src/pages/users/userListUtils.js";

const getRole = (user) => user.courseRole;

describe("getUserNames", () => {
  it("keeps the unknown-user fallback while exposing a distinct display name", () => {
    expect(getUserNames({ displayName: "Student Preferred" })).toEqual({
      legalName: "Unknown User",
      displayName: "Student Preferred",
      distinctDisplayName: "Student Preferred",
    });
  });

  it("does not repeat a display name that is the same as the legal name", () => {
    expect(
      getUserNames({ legalName: "Ada Lovelace", displayName: "ada lovelace" })
        .distinctDisplayName,
    ).toBe("");
  });
});

describe("filterAndSortCourseUsers", () => {
  const users = [
    {
      userId: "student-z",
      legalName: "Zara Student",
      displayName: "Zee",
      courseRole: "student",
      sections: ["002"],
    },
    {
      userId: "faculty-b",
      legalName: "Bryn Faculty",
      displayName: "Professor B",
      courseRole: "faculty",
      sections: [],
    },
    {
      userId: "student-a",
      legalName: "Ada Student",
      displayName: "Ace",
      courseRole: "student",
      sections: ["001"],
    },
    {
      userId: "ta-a",
      legalName: "Alex Assistant",
      displayName: "Lex",
      courseRole: "ta",
      sections: ["001"],
    },
  ];

  it("places staff before students and sorts each group by whole legal name", () => {
    const result = filterAndSortCourseUsers(users, { getRole });

    expect(result.map((user) => user.userId)).toEqual([
      "ta-a",
      "faculty-b",
      "student-a",
      "student-z",
    ]);
  });

  it("searches legal and display names case-insensitively", () => {
    expect(
      filterAndSortCourseUsers(users, { search: "faculty", getRole }).map(
        (user) => user.userId,
      ),
    ).toEqual(["faculty-b"]);
    expect(
      filterAndSortCourseUsers(users, { search: "zEe", getRole }).map(
        (user) => user.userId,
      ),
    ).toEqual(["student-z"]);
  });

  it("applies the section filter before sorting", () => {
    expect(
      filterAndSortCourseUsers(users, {
        sectionFilter: "001",
        getRole,
      }).map((user) => user.userId),
    ).toEqual(["ta-a", "student-a"]);
  });
});

describe("manual access helpers (issue #115)", () => {
  it("labels a person by legal name, then display name, then email", () => {
    expect(personLabel({ legalName: "Ada Lovelace", displayName: "Ada" })).toBe("Ada Lovelace");
    expect(personLabel({ displayName: "Ada", email: "ada@ubc.ca" })).toBe("Ada");
    expect(personLabel({ email: "ada@ubc.ca" })).toBe("ada@ubc.ca");
    expect(personLabel(null, "an instructor")).toBe("an instructor");
  });

  it("explains a manual membership with who granted it and when", () => {
    const note = describeMembershipSource({
      source: "manual",
      addedBy: { legalName: "Ada Lovelace" },
      joinedAt: "2026-09-18T16:00:00.000Z",
    });
    expect(note).toMatch(/^Added by Ada Lovelace on .*2026$/);
  });

  it("copes with a manual membership whose granting instructor is unknown", () => {
    expect(describeMembershipSource({ source: "manual" })).toBe("Added by an instructor");
  });

  it("says nothing for memberships GRASP created itself", () => {
    expect(describeMembershipSource({ source: "roster-sync" })).toBe("");
    expect(describeMembershipSource({})).toBe("");
    expect(describeMembershipSource(undefined)).toBe("");
  });

  it("turns each access event into a sentence", () => {
    const actor = { legalName: "Ada Lovelace" };
    const target = { displayName: "Bob Student" };
    expect(describeAccessEvent({ action: "added", role: "ta", actor, target })).toBe(
      "Ada Lovelace added Bob Student to the course as TA"
    );
    expect(describeAccessEvent({ action: "promoted", role: "ta", actor, target })).toBe(
      "Ada Lovelace made Bob Student a TA"
    );
    expect(describeAccessEvent({ action: "demoted", role: "staff", actor, target })).toBe(
      "Ada Lovelace removed the TA role from Bob Student (now Staff)"
    );
    expect(describeAccessEvent({ action: "removed", role: "student", actor, target })).toBe(
      "Ada Lovelace removed Bob Student from the course (was Student)"
    );
    expect(describeAccessEvent({ action: "permissions-updated", actor, target })).toBe(
      "Ada Lovelace updated the TA permissions of Bob Student"
    );
    expect(describeAccessEvent({ action: "mystery", actor, target })).toBe(
      "Ada Lovelace changed the access of Bob Student"
    );
  });
});
