import { describe, expect, it } from "@jest/globals";
import {
  canvasCourseLabel,
  canvasFileNote,
  canvasFileSelectable,
  canvasImportAvailable,
  describeCanvasImportResult,
  filterCanvasFiles,
} from "../../client/src/lib/canvasMaterialImport.js";

const MAX_BYTES = 50 * 1024 * 1024;

const file = (overrides = {}) => ({
  id: "7001",
  name: "Lecture 1.pdf",
  kind: "pdf",
  size: 2048,
  tooLarge: false,
  imported: null,
  replacesImported: null,
  ...overrides,
});

describe("canvasImportAvailable", () => {
  const connected = { configured: true, connected: true, capabilities: { files: true } };
  const courses = [{ id: "42", name: "Biology 302", code: "BIOC 302" }];

  it("offers From Canvas to a connected instructor with a linked section", () => {
    expect(canvasImportAvailable(connected, courses)).toBe(true);
  });

  // Upload and pasted text are then the only options, as before the feature.
  it.each([
    ["Canvas is not configured on the deployment", { ...connected, configured: false }, courses],
    ["the instructor has not connected Canvas", { ...connected, connected: false }, courses],
    ["the deployment's scopes do not include files", { ...connected, capabilities: { files: false } }, courses],
    ["no section of theirs is linked to Canvas", connected, []],
    ["the linked courses could not be loaded", connected, undefined],
    ["the Canvas status is unknown", undefined, courses],
  ])("hides it when %s", (_reason, canvas, linkedCourses) => {
    expect(canvasImportAvailable(canvas, linkedCourses)).toBe(false);
  });
});

describe("canvasCourseLabel", () => {
  it("shows the course code beside the name when it adds something", () => {
    expect(canvasCourseLabel({ name: "Biology 302", code: "BIOC 302" })).toBe("Biology 302 (BIOC 302)");
    expect(canvasCourseLabel({ name: "DEMO", code: "DEMO" })).toBe("DEMO");
    expect(canvasCourseLabel({ name: "Biology 302", code: "" })).toBe("Biology 302");
    expect(canvasCourseLabel({ name: "", code: "BIOC 302" })).toBe("BIOC 302");
    expect(canvasCourseLabel(undefined)).toBe("Canvas course");
  });
});

describe("filterCanvasFiles", () => {
  const files = [
    file({ id: "1", name: "Lecture 01 - Amino Acids.pptx" }),
    file({ id: "2", name: "Lecture 02 - Enzyme Kinetics.pptx" }),
    file({ id: "3", name: "Glycolysis Study Guide.docx" }),
  ];
  const ids = (search) => filterCanvasFiles(files, search).map((f) => f.id);

  it("returns every file for an empty search", () => {
    expect(filterCanvasFiles(files, "")).toBe(files);
    expect(ids("   ")).toEqual(["1", "2", "3"]);
  });

  it("matches part of a name, whatever the case", () => {
    expect(ids("ENZYME")).toEqual(["2"]);
    expect(ids("lecture")).toEqual(["1", "2"]);
    // One letter is enough: Canvas's own search needs two.
    expect(ids("g")).toEqual(["3"]);
  });

  it("needs every word, in any order", () => {
    expect(ids("kinetics lecture")).toEqual(["2"]);
    expect(ids("lecture glycolysis")).toEqual([]);
  });
});

describe("canvasFileSelectable and canvasFileNote", () => {
  it("lets an ordinary file be picked, with no note", () => {
    expect(canvasFileSelectable(file())).toBe(true);
    expect(canvasFileNote(file(), MAX_BYTES)).toBe("");
  });

  it("blocks a file that is already a material, naming it when it was retitled", () => {
    const imported = file({ imported: { sourceId: "s1", documentTitle: "Lecture 1.pdf" } });
    const retitled = file({ imported: { sourceId: "s1", documentTitle: "Week 1 notes" } });

    expect(canvasFileSelectable(imported)).toBe(false);
    expect(canvasFileNote(imported, MAX_BYTES)).toBe("Already imported");
    expect(canvasFileNote(retitled, MAX_BYTES)).toBe('Already imported as "Week 1 notes"');
  });

  it("blocks a file over the upload limit and says what the limit is", () => {
    const big = file({ tooLarge: true, size: MAX_BYTES + 1 });

    expect(canvasFileSelectable(big)).toBe(false);
    expect(canvasFileNote(big, MAX_BYTES)).toBe("Over the 50 MB limit");
  });

  it("lets a file replaced in Canvas be picked, and says it will be a new material", () => {
    const replaced = file({ replacesImported: { sourceId: "s1", documentTitle: "Lecture 1.pdf" } });

    expect(canvasFileSelectable(replaced)).toBe(true);
    expect(canvasFileNote(replaced, MAX_BYTES)).toMatch(/Replaced in Canvas.*new material/);
  });
});

describe("describeCanvasImportResult", () => {
  const ok = (n) => Array.from({ length: n }, (_, i) => ({ id: String(i), name: `f${i}` }));
  const failed = (n) => ok(n).map((f) => ({ ...f, message: "Import failed" }));

  it("reports a clean import as a success", () => {
    expect(describeCanvasImportResult({ imported: ok(1), errors: [] })).toEqual({
      message: "1 file imported from Canvas",
      type: "success",
    });
    expect(describeCanvasImportResult({ imported: ok(3), errors: [] }).message).toBe(
      "3 files imported from Canvas"
    );
  });

  it("warns when some files failed but others made it", () => {
    expect(describeCanvasImportResult({ imported: ok(2), errors: failed(1) })).toEqual({
      message: "2 files imported from Canvas. 1 file could not be imported.",
      type: "warning",
    });
  });

  it("reports an error when nothing was imported", () => {
    expect(describeCanvasImportResult({ imported: [], errors: failed(2) })).toEqual({
      message: "2 files could not be imported.",
      type: "error",
    });
  });
});
