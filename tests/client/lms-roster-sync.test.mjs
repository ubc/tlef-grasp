import { describe, expect, it } from "@jest/globals";
import {
  CANVAS_ROSTER_SYNC_DISABLED_NOTE,
  canvasCapabilities,
  canvasSyncRowState,
  sectionSyncMode,
  describeCanvasSyncResult,
  describeConfirmationReason,
  formatLastSynced,
  planCounts,
} from "../../client/src/lib/lmsRosterSync.js";
import { describeAccessEvent } from "../../client/src/pages/users/userListUtils.js";

const baseSummary = {
  added: 2,
  restored: 1,
  previouslyRemovedRestored: 0,
  dropped: 3,
  kept: 10,
  unmatched: [],
  dropsSkipped: null,
  coverage: 1,
  errors: [],
};

describe("describeCanvasSyncResult", () => {
  it("reports counts as a plain success when there is nothing to call out", () => {
    expect(describeCanvasSyncResult(baseSummary)).toEqual({
      message: "Synced from Canvas — 2 added, 1 restored, 3 dropped.",
      type: "success",
      hasNotes: false,
    });
  });

  it("warns when drops were skipped for low integration-id coverage", () => {
    const result = describeCanvasSyncResult({
      ...baseSummary,
      dropped: 0,
      dropsSkipped: "low-coverage",
      coverage: 0.456,
      unmatched: [{ name: "A" }, { name: "B" }],
    });
    expect(result.type).toBe("warning");
    expect(result.message).toContain("2 Canvas students could not be matched");
    expect(result.message).toContain("only 46% of the Canvas roster had UBC IDs");
  });

  it("calls out restored-previously-removed students and instructor-skipped drops", () => {
    const result = describeCanvasSyncResult({
      ...baseSummary,
      previouslyRemovedRestored: 1,
      dropsSkipped: "instructor-skipped",
    });
    expect(result.type).toBe("success");
    expect(result.message).toContain(
      "1 student removed from the course earlier was re-added"
    );
    expect(result.message).toContain("No students were dropped, as you chose.");
  });

  it("names students that failed and never reports them as success", () => {
    const result = describeCanvasSyncResult({
      ...baseSummary,
      errors: [{ name: "Ada", action: "add" }, { name: "Bo", action: "drop" }],
    });
    expect(result.type).toBe("warning");
    expect(result.message).toContain("2 students could not be updated (Ada, Bo)");
  });

  it("tolerates a missing summary", () => {
    expect(describeCanvasSyncResult(undefined).message).toBe(
      "Synced from Canvas — 0 added, 0 restored, 0 dropped."
    );
  });
});

describe("confirmation copy", () => {
  const plan = {
    add: 1,
    restore: 0,
    drop: [{ userId: "u1", name: "Ada" }, { userId: "u2", name: "Bo" }],
    unmatched: [{ name: "C" }],
    activeCount: 3,
  };

  it("explains each confirmation reason", () => {
    expect(describeConfirmationReason("first-sync", plan)).toMatch(/first sync/);
    expect(describeConfirmationReason("large-drop", plan)).toContain("(2 of 3)");
    expect(describeConfirmationReason("roster-changed", plan)).toMatch(/changed/);
  });

  it("keeps the large-drop context when a re-prompt says the roster changed", () => {
    // 2 of 3 is more than half.
    expect(describeConfirmationReason("roster-changed", plan)).toContain(
      "more than half of the students currently in this section (2 of 3)"
    );
    // 2 of 10 is not.
    expect(
      describeConfirmationReason("roster-changed", { ...plan, activeCount: 10 })
    ).not.toMatch(/more than half/);
  });

  it("counts add, restore, drop and unmatched", () => {
    expect(planCounts(plan).map((row) => [row.key, row.value])).toEqual([
      ["add", 1],
      ["restore", 0],
      ["drop", 2],
      ["unmatched", 1],
    ]);
  });
});

describe("formatLastSynced", () => {
  it("is empty without a valid date", () => {
    expect(formatLastSynced(null)).toBe("");
    expect(formatLastSynced("not a date")).toBe("");
  });

  it("prefixes a local date", () => {
    expect(formatLastSynced("2026-09-22T17:00:00.000Z")).toMatch(/^Last synced .*2026/);
  });
});

describe("describeAccessEvent for LMS roster sync", () => {
  const actor = { legalName: "Ada Instructor" };
  const target = { legalName: "Bob Student" };

  it("labels a sync add, a restore, and a restore of a removed student", () => {
    expect(
      describeAccessEvent({
        action: "sync-added",
        actor,
        target,
        details: { provider: "canvas", restored: false },
      })
    ).toBe("Ada Instructor added Bob Student to a section from the Canvas roster");
    expect(
      describeAccessEvent({
        action: "sync-added",
        actor,
        target,
        details: { provider: "canvas", restored: true, previouslyRemoved: true },
      })
    ).toBe(
      "Ada Instructor restored Bob Student to a section from the Canvas roster (they had been removed from the course)"
    );
  });

  it("labels a sync drop, with and without the course membership", () => {
    expect(
      describeAccessEvent({
        action: "sync-dropped",
        actor,
        target,
        details: { provider: "canvas", membershipRemoved: true },
      })
    ).toBe(
      "Ada Instructor dropped Bob Student from a section (no longer on the Canvas roster) and removed them from the course"
    );
    expect(
      describeAccessEvent({ action: "sync-dropped", actor, target, details: null })
    ).toBe(
      "Ada Instructor dropped Bob Student from a section (no longer on the LMS roster)"
    );
  });
});

describe("canvasCapabilities", () => {
  it("treats a status without capabilities (older server, disconnected) as everything on", () => {
    const all = { link: true, rosterSync: true, files: true, assignments: true };
    expect(canvasCapabilities(undefined)).toEqual(all);
    expect(canvasCapabilities({ configured: true, connected: false })).toEqual(all);
  });

  it("turns off only what the server reports as off", () => {
    expect(
      canvasCapabilities({
        capabilities: { link: true, rosterSync: false, files: false, assignments: false },
      })
    ).toEqual({ link: true, rosterSync: false, files: false, assignments: false });
    expect(canvasCapabilities({ capabilities: { rosterSync: false } })).toEqual({
      link: true,
      rosterSync: false,
      files: true,
      assignments: true,
    });
  });
});

describe("sectionSyncMode", () => {
  const canvasLinked = { sectionId: "101", lmsLink: { provider: "canvas" } };
  const moodleLinked = { sectionId: "102", lmsLink: { provider: "moodle" } };
  const unlinked = { sectionId: "103" };
  const on = { link: true, rosterSync: true, assignments: true };
  const connected = { pending: false, enabled: true, connected: true, capabilities: on };

  it("keeps the Academic API sync for unlinked and Moodle-linked sections", () => {
    expect(sectionSyncMode(unlinked, connected)).toBe("academic");
    expect(sectionSyncMode(moodleLinked, connected)).toBe("academic");
    expect(
      sectionSyncMode(unlinked, { ...connected, capabilities: { ...on, rosterSync: false } })
    ).toBe("academic");
  });

  it("syncs a Canvas-linked section from Canvas when connected and allowed", () => {
    expect(sectionSyncMode(canvasLinked, connected)).toBe("canvas");
  });

  it("shows a note, never the Academic API sync, when the deployment's scopes leave out roster sync", () => {
    expect(
      sectionSyncMode(canvasLinked, { ...connected, capabilities: { ...on, rosterSync: false } })
    ).toBe("canvas-disabled");
    expect(CANVAS_ROSTER_SYNC_DISABLED_NOTE).toBe(
      "Canvas roster sync isn't enabled on this deployment"
    );
  });

  it("offers no button while the Canvas status loads or the instructor is not connected", () => {
    expect(sectionSyncMode(canvasLinked, { ...connected, pending: true })).toBe("none");
    expect(sectionSyncMode(canvasLinked, { ...connected, connected: false })).toBe("none");
  });

  it("falls back to the Academic API only when Canvas is not configured on this deployment", () => {
    expect(sectionSyncMode(canvasLinked, { ...connected, enabled: false, connected: false })).toBe(
      "academic"
    );
  });
});

describe("canvasSyncRowState", () => {
  const row101 = { sectionId: "101" };
  const row102 = { sectionId: "102" };

  it("is idle on every row when no Canvas sync is pending", () => {
    const mutation = { isPending: false, variables: { sectionId: "101" } };
    expect(canvasSyncRowState(mutation, row101)).toEqual({ busy: false, syncing: false });
    expect(canvasSyncRowState(undefined, row102)).toEqual({ busy: false, syncing: false });
  });

  it("keeps every Canvas row busy while any one syncs; the spinner stays on that row", () => {
    // The observer only reports the latest call, so a second row must not be
    // startable while one sync is in flight.
    const mutation = { isPending: true, variables: { sectionId: "102" } };
    expect(canvasSyncRowState(mutation, row102)).toEqual({ busy: true, syncing: true });
    expect(canvasSyncRowState(mutation, row101)).toEqual({ busy: true, syncing: false });
  });
});
