import { describe, expect, it } from "@jest/globals";
import {
  filterAndSortCourseUsers,
  getUserNames,
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
