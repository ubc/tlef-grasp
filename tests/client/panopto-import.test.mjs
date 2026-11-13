import { describe, expect, it } from "@jest/globals";
import {
  PANOPTO_RETURN_ERRORS,
  describePanoptoImportResult,
  formatDuration,
  panoptoConnectUrl,
  panoptoFolderLabel,
  panoptoSessionNote,
  panoptoSessionSelectable,
} from "../../client/src/lib/panoptoImport.js";

const session = (overrides = {}) => ({
  id: "11111111-2222-3333-4444-555555555555",
  name: "Lecture 1",
  captions: true,
  imported: null,
  ...overrides,
});

describe("panoptoConnectUrl", () => {
  it("asks the server to come back to a GRASP path", () => {
    expect(panoptoConnectUrl("/course-materials?panopto=import")).toBe(
      "/api/panopto/auth/login?returnTo=%2Fcourse-materials%3Fpanopto%3Dimport"
    );
  });

  it("leaves the return path to the server when none is given", () => {
    expect(panoptoConnectUrl()).toBe("/api/panopto/auth/login");
  });
});

describe("PANOPTO_RETURN_ERRORS", () => {
  it("explains every refusal the sign-in callback reports", () => {
    expect([...PANOPTO_RETURN_ERRORS.keys()].sort()).toEqual(
      ["account-mismatch", "error", "identity-unavailable"]
    );
  });
});

describe("formatDuration", () => {
  it.each([
    [3123, "52:03"],
    [3909, "1:05:09"],
    [59.6, "1:00"],
  ])("formats %p seconds as %p", (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
  });

  it.each([null, undefined, 0, -5, Number.NaN])("shows nothing for %p", (value) => {
    expect(formatDuration(value)).toBe("");
  });
});

describe("panoptoSessionSelectable and panoptoSessionNote", () => {
  it("lets an ordinary video be picked, with no note", () => {
    expect(panoptoSessionSelectable(session())).toBe(true);
    expect(panoptoSessionNote(session())).toBe("");
  });

  it("does not offer a video Panopto has no caption link for", () => {
    expect(panoptoSessionSelectable(session({ captions: false }))).toBe(false);
    expect(panoptoSessionNote(session({ captions: false }))).toBe("No captions in Panopto");
  });

  it("does not offer a video already imported, naming a renamed material", () => {
    const imported = session({ imported: { sourceId: "s1", documentTitle: "Week 1 lecture" } });
    expect(panoptoSessionSelectable(imported)).toBe(false);
    expect(panoptoSessionNote(imported)).toBe('Already imported as "Week 1 lecture"');
    expect(panoptoSessionNote(session({ imported: { documentTitle: "Lecture 1" } }))).toBe("Already imported");
  });
});

describe("panoptoFolderLabel", () => {
  it("adds the parent folder so same-named folders can be told apart", () => {
    expect(panoptoFolderLabel({ name: "Lectures", parentName: "BIOL 101" })).toBe("Lectures (in BIOL 101)");
    expect(panoptoFolderLabel({ name: "My Folder", parentName: "" })).toBe("My Folder");
    expect(panoptoFolderLabel({})).toBe("Untitled folder");
  });
});

describe("describePanoptoImportResult", () => {
  it("reports a clean run as a success", () => {
    expect(describePanoptoImportResult({ imported: [{}, {}], errors: [] })).toEqual({
      message: "Captions of 2 videos imported from Panopto",
      type: "success",
    });
  });

  it("warns when some failed", () => {
    expect(describePanoptoImportResult({ imported: [{}], errors: [{}] })).toEqual({
      message: "Captions of 1 video imported from Panopto. 1 video could not be imported.",
      type: "warning",
    });
  });

  it("reports an error when none made it", () => {
    expect(describePanoptoImportResult({ imported: [], errors: [{}, {}] })).toEqual({
      message: "2 videos could not be imported.",
      type: "error",
    });
  });
});
