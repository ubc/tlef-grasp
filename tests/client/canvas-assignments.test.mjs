import { describe, expect, it } from "@jest/globals";
import {
  canvasAssignmentsEnabled,
  canvasChipState,
  describeEnsureResults,
  partitionAfterSave,
  promptItemsForQuizzes,
  promptItemsForSections,
} from "../../client/src/lib/canvasAssignments.js";
import { localToIso } from "../../client/src/pages/quizzes/schedulePayload.js";

const section = (overrides = {}) => ({
  courseSectionId: "s1",
  sectionId: "SEC-101",
  sectionNumber: "101",
  linked: true,
  scheduled: true,
  expireDate: "2026-11-01T06:59:00.000Z",
  assignment: null,
  ...overrides,
});
const created = (overrides = {}) => ({
  status: "created",
  externalAssignmentId: "9001",
  htmlUrl: "https://canvas.example.test/courses/42/assignments/9001",
  dueAt: "2026-11-01T06:59:00.000Z",
  lastError: null,
  ...overrides,
});

describe("localToIso", () => {
  it("turns a datetime-local value into the instant it means in this zone", () => {
    const typed = "2026-09-30T23:59";
    expect(localToIso(typed)).toBe(new Date(typed).toISOString());
    expect(localToIso(typed)).toMatch(/Z$/);
  });

  it("passes an unparseable value through for the server to reject", () => {
    expect(localToIso("")).toBe("");
    expect(localToIso("not a date")).toBe("not a date");
  });
});

describe("canvasAssignmentsEnabled", () => {
  const on = { configured: true, connected: true, capabilities: { assignments: true } };
  it("needs Canvas configured, connected, and the assignment scopes", () => {
    expect(canvasAssignmentsEnabled(on)).toBe(true);
    expect(canvasAssignmentsEnabled({ ...on, configured: false })).toBe(false);
    expect(canvasAssignmentsEnabled({ ...on, connected: false })).toBe(false);
    expect(canvasAssignmentsEnabled({ ...on, capabilities: { assignments: false } })).toBe(false);
    expect(canvasAssignmentsEnabled(undefined)).toBe(false);
  });
});

describe("partitionAfterSave", () => {
  it("updates existing assignments on its own and asks about new linked sections", () => {
    const status = [
      section({ courseSectionId: "s1", assignment: created() }),
      section({ courseSectionId: "s2" }),
      section({ courseSectionId: "s3", assignment: { status: "declined" } }),
      section({ courseSectionId: "s4", linked: false }),
      section({ courseSectionId: "s5" }),
    ];

    const { sync, prompt } = partitionAfterSave(status, ["s1", "s2", "s3", "s4"]);

    expect(sync).toEqual(["s1"]);
    expect(prompt.map((s) => s.courseSectionId)).toEqual(["s2"]);
  });

  it("ignores sections that were not part of the save, and unscheduled ones", () => {
    const status = [
      section({ courseSectionId: "s1", assignment: created() }),
      section({ courseSectionId: "s2", scheduled: false }),
    ];
    expect(partitionAfterSave(status, ["s2"])).toEqual({ sync: [], prompt: [] });
    expect(partitionAfterSave(status, [])).toEqual({ sync: [], prompt: [] });
    expect(partitionAfterSave(undefined, ["s1"])).toEqual({ sync: [], prompt: [] });
  });
});

describe("canvasChipState", () => {
  it("links to the assignment once it exists", () => {
    expect(canvasChipState(section({ assignment: created() }))).toEqual({
      kind: "created",
      href: "https://canvas.example.test/courses/42/assignments/9001",
      title: expect.stringMatching(/^In Canvas, due /),
    });
  });

  it("offers a retry when the last Canvas update failed", () => {
    const state = canvasChipState(
      section({ assignment: created({ lastError: { message: "Canvas was down", at: "2026-10-05T00:00:00Z" } }) })
    );
    expect(state.kind).toBe("failed");
    expect(state.title).toContain("Canvas was down");
  });

  it("offers to create for a scheduled linked section with nothing in Canvas, declined or not", () => {
    expect(canvasChipState(section())).toEqual({ kind: "offer" });
    expect(canvasChipState(section({ assignment: { status: "declined" } }))).toEqual({ kind: "offer" });
  });

  it("shows nothing for an unlinked or unscheduled section", () => {
    expect(canvasChipState(section({ linked: false }))).toBeNull();
    expect(canvasChipState(section({ scheduled: false }))).toBeNull();
    expect(canvasChipState(undefined)).toBeNull();
  });
});

describe("prompt items", () => {
  it("names sections with their due date", () => {
    expect(promptItemsForSections([section(), section({ courseSectionId: "s2", sectionNumber: "", sectionId: "SEC-102" })])).toEqual([
      { key: "s1", label: "Section 101", dueAt: "2026-11-01T06:59:00.000Z" },
      { key: "s2", label: "Section SEC-102", dueAt: "2026-11-01T06:59:00.000Z" },
    ]);
  });

  it("lists only the quizzes without an assignment after a link", () => {
    expect(
      promptItemsForQuizzes([
        { quizId: "q1", name: "Quiz 1", expireDate: "2026-11-01T06:59:00.000Z", assignment: null },
        { quizId: "q2", name: "Quiz 2", expireDate: "2026-12-01T06:59:00.000Z", assignment: { status: "created" } },
        { quizId: "q3", name: "Quiz 3", expireDate: "2026-12-01T06:59:00.000Z", assignment: { status: "declined" } },
      ])
    ).toEqual([{ key: "q1", label: "Quiz 1", dueAt: "2026-11-01T06:59:00.000Z" }]);
  });
});

describe("describeEnsureResults", () => {
  const labelFor = (id) => ({ s1: "101", s2: "102" })[id] || id;

  it("says nothing when nothing changed", () => {
    expect(describeEnsureResults([{ courseSectionId: "s1", status: "unchanged" }], labelFor)).toEqual({
      message: "",
      type: "success",
    });
  });

  it("reports creates and due-date updates", () => {
    expect(
      describeEnsureResults(
        [
          { courseSectionId: "s1", status: "created" },
          { courseSectionId: "s2", status: "updated" },
        ],
        labelFor
      )
    ).toEqual({
      message: "Canvas assignment created for 101. Canvas due date updated for 102.",
      type: "success",
    });
  });

  it("warns when some sections failed, and errors when all did", () => {
    const failure = { courseSectionId: "s2", status: "failed", error: "Canvas could not complete the request." };
    expect(describeEnsureResults([{ courseSectionId: "s1", status: "created" }, failure], labelFor)).toEqual({
      message: "Canvas assignment created for 101. Canvas could not be updated for 102: Canvas could not complete the request.",
      type: "warning",
    });
    expect(describeEnsureResults([failure], labelFor).type).toBe("error");
  });
});
