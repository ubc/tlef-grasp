// [SMILES]...[/SMILES] chemical structure tags in question/option text (ported
// from smiles-renderer.js). Pure string work, no DOM, so tests/client can cover
// it; RichText inserts the result as HTML and draws each canvas afterwards.

let smilesGlobalIndex = 0;

// The tag's content lands in a double-quoted attribute. Callers pass text that
// escapeHtml has already run over, which turns &, < and > into entities but
// leaves quotes alone, so a '"' in the content would end the attribute and add
// attributes of its own. Only the quotes are escaped here: escaping '&' again
// would double-escape the entities escapeHtml produced. The HTML parser decodes
// the value once, so the canvas's data-smiles reads back as the tag's content.
function escapeAttributeQuotes(value) {
  return value.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Replaces each tag with a <canvas data-smiles="..."> for renderSmilesIn.
export function parseSmilesTags(text) {
  if (!text) return text;
  return String(text).replace(/\[SMILES\]\s*(.*?)\s*\[\/SMILES\]/gi, (match, smiles) => {
    const id = `smiles-canvas-${Date.now()}-${smilesGlobalIndex++}-${Math.floor(Math.random() * 1000)}`;
    return `<canvas id="${id}" data-smiles="${escapeAttributeQuotes(smiles.trim())}" width="200" height="200" style="display: inline-block; vertical-align: middle;"></canvas>`;
  });
}
