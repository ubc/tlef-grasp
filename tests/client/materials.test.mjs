import { describe, expect, it } from "@jest/globals";
import {
  getMaterialTypeMeta,
  isCanvasImportMaterial,
} from "../../client/src/lib/materials.js";
import { getMaterialIcon } from "../../client/src/lib/utils.js";

// The course's "From Canvas" material (issue #165): the empty placeholder the
// learning objectives of a Canvas quiz import link to.
describe("the From Canvas material", () => {
  const placeholder = { sourceId: "c1-from-canvas", fileType: "canvas-import", documentTitle: "From Canvas" };

  it("is recognised by its type, and no uploaded file is mistaken for it", () => {
    expect(isCanvasImportMaterial(placeholder)).toBe(true);
    expect(isCanvasImportMaterial({ fileType: "application/pdf", lms: { provider: "canvas" } })).toBe(
      false
    );
    expect(isCanvasImportMaterial({ fileType: "text/plain" })).toBe(false);
    expect(isCanvasImportMaterial(undefined)).toBe(false);
  });

  it("shows as a Canvas quiz import rather than a generic file", () => {
    expect(getMaterialTypeMeta(placeholder.fileType)).toEqual({
      icon: "fa-file-import",
      label: "Canvas quiz import",
      badgeClasses: "bg-gray-100 text-gray-600",
    });
    expect(getMaterialIcon(placeholder.fileType).icon).toBe("fas fa-file-import");
    // Other types are unchanged.
    expect(getMaterialTypeMeta("application/pdf").label).toBe("PDF");
    expect(getMaterialIcon("link").icon).toBe("fas fa-link");
  });
});
