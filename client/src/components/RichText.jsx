import { useEffect, useRef } from "react";
import renderMathInElement from "katex/dist/contrib/auto-render";
import SmilesDrawer from "smiles-drawer";

// Renders question/option text that may contain HTML, KaTeX math delimiters,
// and [SMILES]...[/SMILES] chemical structure tags (ported from smiles-renderer.js).

let smilesGlobalIndex = 0;

export function parseSmilesTags(text) {
  if (!text) return text;
  return String(text).replace(
    /\[SMILES\]\s*(.*?)\s*\[\/SMILES\]/gi,
    (match, smiles) => {
      const id = `smiles-canvas-${Date.now()}-${smilesGlobalIndex++}-${Math.floor(Math.random() * 1000)}`;
      return `<canvas id="${id}" data-smiles="${smiles.trim()}" width="200" height="200" style="display: inline-block; vertical-align: middle;"></canvas>`;
    }
  );
}

function decodeHTMLEntities(text) {
  const textarea = document.createElement("textarea");
  textarea.innerHTML = text;
  return textarea.value;
}

const SMILES_OPTIONS = {
  width: 200,
  height: 200,
  bondThickness: 1.0,
  bondLength: 15,
  shortBondLength: 0.85,
  fontSizeLarge: 10,
  fontSizeSmall: 7,
  padding: 10,
};

export function renderSmilesIn(element) {
  const canvases = element.querySelectorAll("canvas[data-smiles]");
  if (canvases.length === 0) return;

  const drawer = new SmilesDrawer.Drawer(SMILES_OPTIONS);
  canvases.forEach((canvas) => {
    const raw = canvas.getAttribute("data-smiles");
    if (!raw || !canvas.id) return;
    const smiles = decodeHTMLEntities(raw);
    try {
      SmilesDrawer.parse(
        smiles,
        (tree) => drawer.draw(tree, canvas.id, "light", false),
        () => {
          const ctx = canvas.getContext("2d");
          ctx.font = "10px Arial";
          ctx.fillStyle = "red";
          ctx.fillText("SMILES Error", 10, 20);
        }
      );
    } catch {
      // Ignore drawing errors for malformed SMILES
    }
  });
}

export function renderKatexIn(element) {
  renderMathInElement(element, {
    delimiters: [
      { left: "$$", right: "$$", display: true },
      { left: "$", right: "$", display: false },
      { left: "\\(", right: "\\)", display: false },
      { left: "\\[", right: "\\]", display: true },
    ],
    throwOnError: false,
  });
}

export default function RichText({ text, className = "", as: Tag = "div" }) {
  const ref = useRef(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    renderKatexIn(element);
    renderSmilesIn(element);
  }, [text]);

  return (
    <Tag
      ref={ref}
      className={`min-w-0 max-w-full break-words [overflow-wrap:anywhere] ${className}`}
      dangerouslySetInnerHTML={{ __html: parseSmilesTags(text ?? "") }}
    />
  );
}
