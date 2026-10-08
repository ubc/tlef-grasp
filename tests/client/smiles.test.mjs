import { describe, expect, it } from "@jest/globals";
import { parseSmilesTags } from "../../client/src/lib/smiles.js";

// The canvas ids carry a timestamp, a counter and a random part.
const ID = /^smiles-canvas-\d+-\d+-\d+$/;

// The attributes of every <canvas> in the HTML, as [name, value] pairs, read
// the way an HTML parser splits a tag: a double-quoted value ends at the next '"'.
const canvasAttributes = (html) =>
  Array.from(html.matchAll(/<canvas\s([^>]*)>/g), ([, inside]) =>
    Array.from(inside.matchAll(/([^\s=]+)="([^"]*)"/g), ([, name, value]) => [name, value])
  );

const STYLE = "display: inline-block; vertical-align: middle;";

describe("parseSmilesTags", () => {
  it("turns a tag into a canvas that carries its SMILES", () => {
    const html = parseSmilesTags("Ethanol: [SMILES] CCO [/SMILES] is shown.");
    const [attributes] = canvasAttributes(html);
    expect(attributes.map(([name]) => name)).toEqual(["id", "data-smiles", "width", "height", "style"]);
    expect(attributes[0][1]).toMatch(ID);
    expect(attributes.slice(1)).toEqual([
      ["data-smiles", "CCO"],
      ["width", "200"],
      ["height", "200"],
      ["style", STYLE],
    ]);
    expect(html.startsWith('Ethanol: <canvas id="')).toBe(true);
    expect(html.endsWith("></canvas> is shown.")).toBe(true);
  });

  it("keeps a quote in the tag inside data-smiles instead of adding attributes", () => {
    // escapeHtml leaves quotes alone, so this reaches parseSmilesTags as typed.
    const payload = '[SMILES]C" style="position:fixed;inset:0" x="[/SMILES]';
    const [attributes] = canvasAttributes(parseSmilesTags(payload));
    expect(attributes.map(([name]) => name)).toEqual(["id", "data-smiles", "width", "height", "style"]);
    expect(attributes[1]).toEqual([
      "data-smiles",
      "C&quot; style=&quot;position:fixed;inset:0&quot; x=&quot;",
    ]);
    expect(attributes[4]).toEqual(["style", STYLE]);
  });

  it("escapes single quotes too", () => {
    const [attributes] = canvasAttributes(parseSmilesTags("[SMILES]C' onclick='x[/SMILES]"));
    expect(attributes[1]).toEqual(["data-smiles", "C&#39; onclick=&#39;x"]);
  });

  it("leaves the entities escapeHtml produced as they are", () => {
    // A reaction SMILES after escapeHtml: '>' is already '&gt;'.
    const [attributes] = canvasAttributes(parseSmilesTags("[SMILES]CC&gt;&gt;C=C[/SMILES]"));
    expect(attributes[1]).toEqual(["data-smiles", "CC&gt;&gt;C=C"]);
  });

  it("handles several tags, in any case, and leaves other text alone", () => {
    const html = parseSmilesTags("[smiles]O[/smiles] and [SMILES]N[/SMILES]");
    expect(canvasAttributes(html).map((attributes) => attributes[1])).toEqual([
      ["data-smiles", "O"],
      ["data-smiles", "N"],
    ]);
    const ids = canvasAttributes(html).map((attributes) => attributes[0][1]);
    expect(ids[0]).not.toBe(ids[1]);
    expect(parseSmilesTags("No structure here.")).toBe("No structure here.");
  });

  it("passes empty text through", () => {
    expect(parseSmilesTags("")).toBe("");
    expect(parseSmilesTags(null)).toBeNull();
  });
});
