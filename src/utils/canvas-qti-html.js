/**
 * Converts the HTML inside a Canvas Classic Quizzes export (question text,
 * answer options, feedback) into what GRASP stores: plain text plus KaTeX
 * delimiters, with images pulled out as references.
 *
 * GRASP escapes every question field before RichText renders it, so markup
 * cannot survive. What carries meaning is kept another way:
 *   - Canvas equation images and codecogs images become `\( latex \)`;
 *   - <sup>/<sub> (and Google Docs' vertical-align spans) become Unicode
 *     super/subscripts, or LaTeX when a character has no Unicode form;
 *   - paragraphs become "\n" (the client renders with white-space: pre-line);
 *   - tables become a KaTeX array, or lines of text when they hold an image
 *     or are too big for one;
 *   - images are listed separately, with "(Image N)" markers in the text when
 *     the reader needs to know where each one went.
 * Anything lost or changed in a way the instructor should check is reported in
 * `warnings`, which the importer turns into a Draft status with reasons.
 *
 * Pure: no network (equation and codecogs images are never fetched), no I/O.
 *
 * The work per field stays close to linear in its size, because a staff upload
 * is converted synchronously on the server: the HTML is parsed with
 * htmlparser2 (parse5, cheerio's default, moves every top-level node one by
 * one, which is quadratic), a field with more than MAX_FIELD_TAGS tags is not
 * converted, elements nested deeper than MAX_DEPTH are left out, and the
 * arrays a field's tables become are bounded by the field's own length.
 */

const cheerio = require('cheerio');

const WARNINGS = {
  'image-unsupported': 'An image used a source that cannot be imported',
  'table-flattened': 'A table with images or too many cells was flattened to text',
  'linked-file': 'A linked file was not imported',
  'media-removed': 'Embedded media was removed',
  'equation-unsafe': 'An equation contains \\) or \\] and may not display correctly',
  'equation-missing': 'An equation image had no readable LaTeX and was removed',
  'list-renumbered': 'A numbered list used labels that were changed to 1., 2., 3.',
  'too-complex': 'Text with too much formatting was left out',
  'too-long': 'Text that was too long to import was left out',
};

// htmlparser2 in HTML mode, with entities decoded (cheerio's default is parse5).
const PARSE_OPTIONS = { xml: { xmlMode: false, decodeEntities: true } };

// Removed with their content and without a warning: never visible to a Canvas
// student, or (hidden-readable MathML) a duplicate of an equation we keep.
const SILENT_TAGS = new Set(['script', 'style', 'template', 'noscript', 'math', 'meta', 'link']);
const SILENT_CLASSES = ['hidden-readable', 'screenreader-only'];

const MEDIA_TAGS = new Set(['iframe', 'video', 'audio', 'object', 'embed', 'svg', 'canvas']);

const BLOCK_TAGS = new Set([
  'p', 'div', 'li', 'tr', 'blockquote', 'pre', 'ul', 'ol', 'table', 'section',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'article', 'aside', 'header', 'footer',
  'nav', 'main', 'figure', 'figcaption', 'address', 'center', 'dl', 'dt', 'dd',
  'details', 'summary', 'fieldset', 'legend', 'caption',
]);

const SUP_MAP = {
  0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹',
  '+': '⁺', '-': '⁻', '−': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ', i: 'ⁱ',
};
const SUB_MAP = {
  0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉',
  '+': '₊', '-': '₋', '−': '₋', '=': '₌', '(': '₍', ')': '₎',
};

// Characters that would end or break `\text{...}`.
const LATEX_TEXT_ESCAPES = {
  '\\': '\\textbackslash{}',
  '{': '\\{',
  '}': '\\}',
  $: '\\$',
  '&': '\\&',
  '#': '\\#',
  '^': '\\textasciicircum{}',
  _: '\\_',
  '%': '\\%',
  '~': '\\textasciitilde{}',
};

const FILEBASE = '$IMS-CC-FILEBASE$';
const VERTICAL_ALIGN = /vertical-align\s*:\s*(super|sub)\b/i;
const DISPLAY_BLOCK = /display\s*:\s*block/i;
const WHITESPACE = /\s+/g;
// RichText turns [SMILES]...[/SMILES] into a <canvas> (and trusts its content)
// before KaTeX runs, so it sees our LaTeX too; imported text must never
// trigger that.
const SMILES_TAG = /\[(\/?smiles\])/gi;
// KaTeX math delimiters an author typed into the text themselves.
const TYPED_MATH = /\\[([]/;
// As in a browser: rowspan is clamped to 65534 (and "0" runs to the end of its
// row group), colspan to 1000.
const MAX_ROWSPAN = 65534;
const MAX_COLSPAN = 1000;
// Largest grid laid out as an array. Every array row is padded to the widest
// one, so the LaTeX grows as rows x columns; a bigger table is flattened to
// text, which grows only with the HTML.
const MAX_TABLE_COLUMNS = 100;
const MAX_TABLE_CELLS = 2500;
// All the arrays of one field together may be at most this many times as long
// as the field's HTML (real tables are under 1x); past that a table is
// flattened. Without it, many small tables padded out to MAX_TABLE_CELLS give
// about 33 times more text than HTML.
const TABLE_LATEX_PER_HTML_CHAR = 3;
// A field with more tags ("<") than this is not converted. Real fields have
// under 200; a 50 x 50 table has about 5,100. The cap bounds the parser's
// cost, which grows with nesting depth times tags.
const MAX_FIELD_TAGS = 10000;
// A field longer than this is not converted. The longest real field is about
// 6,500 characters; escaping can make output up to about 18 times longer than
// its input, so the cap also bounds what one field can produce.
const MAX_FIELD_CHARS = 500000;
// Elements nested deeper than this are left out (real fields nest under 10).
// The walk is recursive, so this keeps it far from the stack limit.
const MAX_DEPTH = 200;

// <ol type> values and list-style-type keywords GRASP writes as labels.
const LIST_TYPE_ATTRIBUTE = new Set(['1', 'a', 'A', 'i', 'I']);
const LIST_STYLE_TYPES = {
  decimal: '1',
  'lower-alpha': 'a',
  'lower-latin': 'a',
  'upper-alpha': 'A',
  'upper-latin': 'A',
  'lower-roman': 'i',
  'upper-roman': 'I',
};
const ROMAN_NUMERALS = [
  [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'],
  [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i'],
];

function makeWarning(code) {
  return { code, message: WARNINGS[code] };
}

function addWarning(ctx, code) {
  if (!ctx.warnings.some((warning) => warning.code === code)) {
    ctx.warnings.push(makeWarning(code));
  }
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseUrl(value) {
  const raw = value.startsWith('//') ? `https:${value}` : value;
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function isCodecogsUrl(value) {
  const url = parseUrl(value || '');
  if (!url) return false;
  const host = url.hostname.toLowerCase();
  return host === 'codecogs.com' || host.endsWith('.codecogs.com');
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(value);
}

function imageKind(src) {
  if (src.startsWith(FILEBASE)) return 'bundled';
  if (isHttpUrl(src)) return 'remote';
  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(src)) return 'data';
  // A relative path names a file inside the package; anything with a scheme,
  // protocol-relative or rooted at "/" points outside it.
  if (src && !/^[a-z][a-z0-9+.-]*:/i.test(src) && !src.startsWith('/')) return 'bundled';
  return 'other';
}

function hasClass(el, name) {
  const classes = (el.attribs && el.attribs.class) || '';
  return classes.split(/\s+/).includes(name);
}

function escapeLatexText(text) {
  return text.replace(/[\\{}$&#^_%~]/g, (ch) => LATEX_TEXT_ESCAPES[ch]);
}

// ---------------------------------------------------------------------------
// HTML -> tokens
//
// Token shapes:
//   { type: 'text', value }              raw text, whitespace not yet collapsed
//   { type: 'math', latex, display }
//   { type: 'script', kind: 'sup'|'sub', children: Token[] }
//   { type: 'break' }                    block boundary
//   { type: 'prefix', value }            line break; the bullet (or null) is
//                                        attached to the next non-empty line
//   { type: 'image', index }             index into ctx.images
// ---------------------------------------------------------------------------

// Appends a token, merging adjacent super/subscripts of the same kind
// (Canvas content has <sup>-</sup><sup>3</sup>, and Google Docs pastes one
// vertical-align span per character run).
function pushToken(out, token) {
  if (token.type === 'text' && token.value === '') return;
  const last = out[out.length - 1];
  if (token.type === 'script' && last && last.type === 'script' && last.kind === token.kind) {
    token.children.forEach((child) => pushToken(last.children, child));
    return;
  }
  out.push(token);
}

function walkChildren(node, out, ctx) {
  (node.children || []).forEach((child) => walkNode(child, out, ctx));
}

// ctx.depth is shared by the copies of ctx made for <pre>.
function walkNode(node, out, ctx) {
  if (ctx.depth.n >= MAX_DEPTH) {
    addWarning(ctx, 'too-complex');
    return;
  }
  ctx.depth.n += 1;
  try {
    walkNodeAtDepth(node, out, ctx);
  } finally {
    ctx.depth.n -= 1;
  }
}

function walkNodeAtDepth(node, out, ctx) {
  if (node.type === 'text') {
    if (ctx.inPre) {
      node.data.split(/\r\n|\r|\n/).forEach((part, i) => {
        if (i > 0) pushToken(out, { type: 'break' });
        pushToken(out, { type: 'text', value: part });
      });
    } else {
      pushToken(out, { type: 'text', value: node.data });
    }
    return;
  }
  // Comments, CDATA (a bogus comment in HTML) and directives carry nothing.
  if (node.type !== 'tag' && node.type !== 'script' && node.type !== 'style') return;

  const name = node.name.toLowerCase();
  if (SILENT_TAGS.has(name) || SILENT_CLASSES.some((cls) => hasClass(node, cls))) return;
  if (MEDIA_TAGS.has(name)) {
    addWarning(ctx, 'media-removed');
    return;
  }

  switch (name) {
    case 'img':
      walkImage(node, out, ctx);
      return;
    case 'br':
      pushToken(out, { type: 'break' });
      return;
    case 'table':
      walkTable(node, out, ctx);
      return;
    case 'ul':
    case 'ol':
      walkList(node, out, ctx, name === 'ol');
      return;
    case 'li':
      walkListItem(node, out, ctx, '• ');
      return;
    case 'a':
      walkLink(node, out, ctx);
      return;
    default:
      break;
  }

  if (BLOCK_TAGS.has(name)) {
    pushToken(out, { type: 'break' });
    walkChildren(node, out, name === 'pre' ? { ...ctx, inPre: true } : ctx);
    pushToken(out, { type: 'break' });
    return;
  }

  const style = (node.attribs && node.attribs.style) || '';
  const align = style.match(VERTICAL_ALIGN);
  let scriptKind = name === 'sup' || name === 'sub' ? name : null;
  if (!scriptKind && align) scriptKind = align[1].toLowerCase() === 'super' ? 'sup' : 'sub';
  if (scriptKind) {
    const script = { type: 'script', kind: scriptKind, children: [] };
    walkChildren(node, script.children, ctx);
    pushToken(out, script);
    return;
  }

  // span, em, strong, b, i, u, font, … keep only their content.
  walkChildren(node, out, ctx);
}

function equationLatex(attribs) {
  const fromData = (attribs['data-equation-content'] || '').trim();
  if (fromData) return fromData;
  const fromAlt = (attribs.alt || '').replace(/^\s*LaTeX:\s*/i, '').trim();
  if (fromAlt) return fromAlt;
  // The src path is the LaTeX URI-encoded twice.
  const match = (attribs.src || '').match(/\/equation_images\/([^?#]*)/);
  return match ? safeDecode(safeDecode(match[1])).trim() : '';
}

function codecogsLatex(attribs) {
  const fromTitle = (attribs.title || '').trim();
  if (fromTitle) return fromTitle;
  const src = attribs.src || '';
  const query = src.indexOf('?');
  return query === -1 ? '' : safeDecode(src.slice(query + 1)).trim();
}

function pushMath(out, ctx, latex, display) {
  if (!latex) {
    addWarning(ctx, 'equation-missing');
    return;
  }
  if (latex.includes('\\)') || latex.includes('\\]')) addWarning(ctx, 'equation-unsafe');
  pushToken(out, { type: 'math', latex, display });
}

function walkImage(node, out, ctx) {
  const attribs = node.attribs || {};
  // Some exporters percent-encode the package token.
  const src = (attribs.src || '').trim().replace(/^%24IMS-CC-FILEBASE%24/i, FILEBASE);

  if (hasClass(node, 'equation_image')) {
    pushMath(out, ctx, equationLatex(attribs), DISPLAY_BLOCK.test(attribs.style || ''));
    return;
  }
  if (isCodecogsUrl(src)) {
    pushMath(out, ctx, codecogsLatex(attribs), false);
    return;
  }

  const kind = imageKind(src);
  if (kind === 'other') addWarning(ctx, 'image-unsupported');
  ctx.images.push({ src, alt: (attribs.alt || '').trim(), kind, marker: null });
  pushToken(out, { type: 'image', index: ctx.images.length - 1 });
}

function walkLink(node, out, ctx) {
  const href = ((node.attribs && node.attribs.href) || '').trim();
  walkChildren(node, out, ctx);

  // codecogs wraps each formula in a link to its online editor.
  if (!href || isCodecogsUrl(href)) return;
  // Course files and anything carrying a Canvas verifier (a credential) are
  // never written out; the instructor is told the file is missing.
  if (href.startsWith(FILEBASE) || href.includes('/files/') || /verifier=/i.test(href)) {
    addWarning(ctx, 'linked-file');
    return;
  }
  if (isHttpUrl(href)) {
    const linkText = textContent(node).replace(WHITESPACE, ' ').trim();
    if (linkText !== href) pushToken(out, { type: 'text', value: ` (${href})` });
  }
}

// All the text under a node, as cheerio's .text() gives it, without recursion
// (a link can hold content nested far deeper than MAX_DEPTH).
function textContent(node) {
  let text = '';
  const stack = [node];
  while (stack.length) {
    const current = stack.pop();
    if (current.type === 'text') text += current.data;
    else if (current.type !== 'comment' && current.children) {
      for (let i = current.children.length - 1; i >= 0; i -= 1) stack.push(current.children[i]);
    }
  }
  return text;
}

// The label style of an <ol>, as a browser picks it: list-style-type in the
// style attribute (the last declaration wins), else the type attribute.
// Returns '1', 'a', 'A', 'i' or 'I', or null for a style GRASP cannot write.
function listStyleOf(node) {
  const attribs = node.attribs || {};
  let cssType = null;
  (attribs.style || '').split(';').forEach((declaration) => {
    const colon = declaration.indexOf(':');
    if (colon === -1) return;
    const property = declaration.slice(0, colon).trim().toLowerCase();
    const value = declaration.slice(colon + 1).replace(/!\s*important\s*$/i, '').trim().toLowerCase();
    if (property === 'list-style-type' && value) cssType = value;
    if (property === 'list-style') {
      // The shorthand: the type is the word that is not a position or image.
      const words = value.split(/\s+/).filter((word) => word && !/^(inside|outside)$|^url\(/.test(word));
      const type = words.find((word) => word !== 'none') || (words.includes('none') ? 'none' : null);
      if (type) cssType = type;
    }
  });
  if (cssType) return LIST_STYLE_TYPES[cssType] || null;
  const type = (attribs.type || '').trim();
  return LIST_TYPE_ATTRIBUTE.has(type) ? type : '1';
}

function romanNumeral(number) {
  let rest = number;
  let roman = '';
  ROMAN_NUMERALS.forEach(([value, numeral]) => {
    while (rest >= value) {
      roman += numeral;
      rest -= value;
    }
  });
  return roman;
}

// The label for item `number`. As in a browser, a number a style cannot write
// (below 1, or a Roman numeral past 3999) falls back to decimal.
function listLabel(number, style) {
  if ((style === 'a' || style === 'A') && number >= 1) {
    let label = '';
    for (let rest = number; rest > 0; rest = Math.floor((rest - 1) / 26)) {
      label = String.fromCharCode(97 + ((rest - 1) % 26)) + label;
    }
    return style === 'A' ? label.toUpperCase() : label;
  }
  if ((style === 'i' || style === 'I') && number >= 1 && number <= 3999) {
    const roman = romanNumeral(number);
    return style === 'I' ? roman.toUpperCase() : roman;
  }
  return String(number);
}

function walkList(node, out, ctx, ordered) {
  const start = parseInt(node.attribs && node.attribs.start, 10);
  let number = Number.isFinite(start) ? start : 1;
  let style = '1';
  if (ordered) {
    style = listStyleOf(node);
    if (!style) {
      // lower-greek, none, a custom string, ...: numbered 1., 2., 3. instead.
      addWarning(ctx, 'list-renumbered');
      style = '1';
    }
  }
  pushToken(out, { type: 'break' });
  (node.children || []).forEach((child) => {
    if (child.type === 'tag' && child.name.toLowerCase() === 'li') {
      walkListItem(child, out, ctx, ordered ? `${listLabel(number, style)}. ` : '• ');
      number += 1;
    } else {
      walkNode(child, out, ctx);
    }
  });
  pushToken(out, { type: 'break' });
}

function walkListItem(node, out, ctx, prefix) {
  pushToken(out, { type: 'prefix', value: prefix });
  walkChildren(node, out, ctx);
  // Ends the item; an empty item's bullet must not land on the next line.
  pushToken(out, { type: 'prefix', value: null });
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

function elementChildren(node, names) {
  return (node.children || []).filter(
    (child) => child.type === 'tag' && names.includes(child.name.toLowerCase()),
  );
}

const TABLE_PARTS = new Set(['caption', 'colgroup', 'col', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th']);

function isCell(node) {
  return node.type === 'tag' && ['td', 'th'].includes(node.name.toLowerCase());
}

// Content a browser moves out of a table and shows just before it: text and
// elements written in the table, a row group or a row rather than in a cell.
// (htmlparser2 leaves them where they are written.) A caption is shown too;
// walkTable walks the ones written straight in <table>.
function isFostered(node, tableLevel) {
  if (node.type === 'text') return node.data.trim() !== '';
  if (node.type === 'comment' || node.type === 'directive' || node.type === 'cdata') return false;
  if (node.type !== 'tag') return true;
  const name = node.name.toLowerCase();
  return !TABLE_PARTS.has(name) || (name === 'caption' && !tableLevel);
}

// The cell `node` and, after it, any td/th written straight inside it: an
// unclosed <td> before a <th> (htmlparser2 lets a <th> close only a <th>;
// a browser starts a new cell). Each as { node, children }.
function cellsOf(node, level = 0) {
  const nested = level < 2 ? node.children.filter(isCell) : [];
  const own = nested.length ? node.children.filter((child) => !isCell(child)) : node.children;
  return [{ node, children: own }, ...nested.flatMap((cell) => cellsOf(cell, level + 1))];
}

// Rows of this table only (not of a table nested in a cell), by row group:
// each thead/tbody/tfoot, and each run of rows written straight in <table>.
// Each row is its list of cells (see cellsOf). As in a browser, cells written
// outside a <tr> make a row, and a row group written inside another one or
// inside a row (an unclosed <tbody> before a <thead>) ends them.
function tableStructure(table, ctx) {
  const groups = [];
  const fostered = [];
  const readRows = (parent, level) => {
    let current = null;
    let row = null;
    const rows = () => {
      if (!current) {
        current = [];
        groups.push(current);
      }
      return current;
    };
    const visit = (child, inRow) => {
      const name = child.type === 'tag' ? child.name.toLowerCase() : '';
      if (name === 'tr') {
        // A row with no cells still uses up a row of a rowspan.
        row = [];
        rows().push(row);
        child.children.forEach((part) => visit(part, true));
        row = null;
      } else if (isCell(child)) {
        if (!row) {
          row = [];
          rows().push(row);
        }
        row.push(...cellsOf(child));
      } else if (name === 'thead' || name === 'tbody' || name === 'tfoot') {
        current = null;
        row = null;
        if (level < MAX_DEPTH) readRows(child, level + 1);
        else addWarning(ctx, 'too-complex');
      } else if (isFostered(child, level === 0 && !inRow)) {
        fostered.push(child);
      }
    };
    (parent.children || []).forEach((child) => visit(child, false));
  };
  readRows(table, 0);
  return { groups, fostered };
}

function spanOf(cell, name) {
  const span = parseInt(cell.attribs && cell.attribs[name], 10);
  // As in a browser. layoutTable ends every rowspan at the end of its row
  // group, which is where rowspan="0" runs to; a colspan wider than
  // MAX_TABLE_COLUMNS flattens the table.
  if (name === 'rowspan' && span === 0) return MAX_ROWSPAN;
  if (!Number.isFinite(span) || span <= 1) return 1;
  return Math.min(span, name === 'rowspan' ? MAX_ROWSPAN : MAX_COLSPAN);
}

// Lays the cells out on a grid the way a browser does: a cell starts at the
// first column of its row not covered by a rowspan from above and takes
// `colspan` columns; a rowspan stops at the end of its row group. Returns one
// array per row, holding the cell that starts in each column or null (covered
// by a span). Rows with no cells of their own are dropped after the layout,
// so a rowspan still counts them.
// Returns null as soon as the grid passes MAX_TABLE_COLUMNS or
// MAX_TABLE_CELLS, so the work per row stays within MAX_TABLE_COLUMNS.
function layoutTable(groups) {
  const grid = [];
  let columns = 0;
  for (const rows of groups) {
    // Column -> rows still covered from above, for spanned columns only.
    let covered = new Map();
    for (const cells of rows) {
      const below = new Map();
      covered.forEach((count, col) => {
        if (count > 1) below.set(col, count - 1);
      });
      const slots = [];
      let col = 0;
      for (const cell of cells) {
        while (covered.has(col)) col += 1;
        if (col + cell.colspan > MAX_TABLE_COLUMNS) return null;
        for (let i = 0; i < cell.colspan; i += 1, col += 1) {
          slots[col] = i === 0 ? cell : null;
          if (cell.rowspan > 1) below.set(col, Math.max(below.get(col) || 0, cell.rowspan - 1));
        }
      }
      if (cells.length) {
        grid.push(Array.from(slots, (slot) => slot || null));
        columns = Math.max(columns, slots.length);
        if (grid.length * columns > MAX_TABLE_CELLS) return null;
      }
      covered = below;
    }
  }
  return grid;
}

function containsImage(tokens) {
  return tokens.some((token) => token.type === 'image'
    || (token.type === 'script' && containsImage(token.children)));
}

// LaTeX for the inside of an array cell or a LaTeX super/subscript: text in
// \text{}, math as written, scripts as ^{}/_{}. Line structure is flattened.
function latexForTextCell(tokens) {
  const pieces = [];
  let text = '';
  const flushText = () => {
    if (text) pieces.push({ kind: 'text', value: text });
    text = '';
  };
  tokens.forEach((token) => {
    if (token.type === 'text') text += token.value;
    else if (token.type === 'break' || token.type === 'prefix') text += ' ';
    else if (token.type === 'math') {
      flushText();
      pieces.push({ kind: 'latex', value: token.latex });
    } else if (token.type === 'script') {
      flushText();
      const inner = latexForTextCell(token.children);
      if (inner) pieces.push({ kind: 'script', value: `${token.kind === 'sup' ? '^' : '_'}{${inner}}` });
    }
  });
  flushText();

  // Collapse whitespace, then trim the outer edges of the whole cell.
  pieces.forEach((piece) => {
    if (piece.kind === 'text') piece.value = piece.value.replace(WHITESPACE, ' ');
  });
  if (pieces.length && pieces[0].kind === 'text') pieces[0].value = pieces[0].value.trimStart();
  const last = pieces[pieces.length - 1];
  if (last && last.kind === 'text') last.value = last.value.trimEnd();

  return pieces
    .filter((piece) => piece.value !== '')
    .map((piece, i) => {
      if (piece.kind === 'text') return `\\text{${escapeLatexText(piece.value)}}`;
      // A script needs something to attach to.
      if (piece.kind === 'script' && i === 0) return `{}${piece.value}`;
      return piece.value;
    })
    .join('');
}

// Each row's own cells on a line, spans ignored, so nothing is padded. Used
// for a table too big for an array.
function flattenUnpadded(groups, out, ctx) {
  const rows = groups.flat();
  if (!rows.some(rowHasContent)) return;
  addWarning(ctx, 'table-flattened');
  flattenTable(rows, out);
}

// The " | " flattenTable writes for the columns a span covers.
function flattenedPadding(grid) {
  return grid.reduce((sum, slots) => {
    let end = slots.length;
    while (end > 0 && !slots[end - 1]) end -= 1;
    return sum + 3 * slots.slice(0, end).filter((slot) => !slot).length;
  }, 0);
}

// ctx.tableLatex counts the array LaTeX the field holds so far, against
// TABLE_LATEX_PER_HTML_CHAR times its HTML length. A nested table's array is
// part of its outer table's, so the outer one replaces its count.
function walkTable(table, out, ctx) {
  const { groups: rowGroups, fostered } = tableStructure(table, ctx);
  fostered.forEach((node) => walkNode(node, out, ctx));
  elementChildren(table, ['caption']).forEach((caption) => walkNode(caption, out, ctx));

  const before = ctx.tableLatex.used;
  const groups = rowGroups.map((rows) => rows.map((cells) => cells.map(({ node, children }) => {
    const tokens = [];
    children.forEach((child) => walkNode(child, tokens, ctx));
    return { tokens, colspan: spanOf(node, 'colspan'), rowspan: spanOf(node, 'rowspan') };
  })));
  const grid = layoutTable(groups);
  if (!grid) {
    flattenUnpadded(groups, out, ctx);
    return;
  }
  if (grid.length === 0) return;

  // An array cannot hold an image. (A nested table is fine: it is already an
  // array by now, and KaTeX nests arrays.)
  if (grid.some((slots) => slots.some((cell) => cell && containsImage(cell.tokens)))) {
    const padding = flattenedPadding(grid);
    if (ctx.tableLatex.used + padding > ctx.tableLatex.limit) {
      flattenUnpadded(groups, out, ctx);
      return;
    }
    ctx.tableLatex.used += padding;
    addWarning(ctx, 'table-flattened');
    flattenTable(grid, out);
    return;
  }

  // A spanned cell's text goes in its first column; the columns and rows it
  // covers stay blank.
  const latexRows = grid.map((slots) => slots.map((cell) => (cell ? latexForTextCell(cell.tokens) : '')));
  if (latexRows.every((row) => row.every((cell) => cell === ''))) return;
  const columns = Math.max(...latexRows.map((row) => row.length));
  const body = latexRows
    .map((row) => {
      const padded = row.concat(Array(columns - row.length).fill(''));
      return `${padded.join(' & ')} \\\\ \\hline`;
    })
    .join(' ');
  const latex = `\\begin{array}{|${'c|'.repeat(columns)}}\\hline ${body} \\end{array}`;
  if (before + latex.length > ctx.tableLatex.limit) {
    flattenUnpadded(groups, out, ctx);
    return;
  }
  ctx.tableLatex.used = before + latex.length;
  pushToken(out, { type: 'math', latex, display: true });
}

function rowHasContent(slots) {
  return slots.some((cell) => cell && cell.tokens.some((token) => token.type === 'image'
    || token.type === 'math' || token.type === 'script'
    || (token.type === 'text' && token.value.trim())));
}

// One line per row, cells separated by " | ". Display math and blocks inside a
// cell are kept inline so a row stays on one line. A column covered by a span
// (null) is an empty cell, so later cells stay under their headers.
function flattenTable(grid, out) {
  grid.forEach((slots) => {
    if (!rowHasContent(slots)) return;
    let end = slots.length;
    while (!slots[end - 1]) end -= 1;
    pushToken(out, { type: 'break' });
    slots.slice(0, end).forEach((cell, i) => {
      if (i > 0) pushToken(out, { type: 'text', value: ' | ' });
      if (!cell) return;
      cell.tokens.forEach((token) => {
        if (token.type === 'break' || token.type === 'prefix') pushToken(out, { type: 'text', value: ' ' });
        else if (token.type === 'math') pushToken(out, { ...token, display: false });
        else pushToken(out, token);
      });
    });
    pushToken(out, { type: 'break' });
  });
}

// ---------------------------------------------------------------------------
// Tokens -> text
// ---------------------------------------------------------------------------

function hasContentAfterFirstImage(tokens) {
  let seenImage = false;
  const visit = (list) => list.some((token) => {
    if (token.type === 'image') {
      seenImage = true;
      return false;
    }
    if (!seenImage) {
      return token.type === 'script' ? visit(token.children) : false;
    }
    if (token.type === 'text') return token.value.trim() !== '';
    if (token.type === 'math') return true;
    if (token.type === 'script') return visit(token.children);
    return false;
  });
  return visit(tokens);
}

function collectImages(tokens, found = []) {
  tokens.forEach((token) => {
    if (token.type === 'image') found.push(token);
    if (token.type === 'script') collectImages(token.children, found);
  });
  return found;
}

// Renders a super/subscript in running text. Returns pieces for the line:
// Unicode as plain text when every character has a form, LaTeX otherwise.
function renderScript(token) {
  const map = token.kind === 'sup' ? SUP_MAP : SUB_MAP;
  const children = token.children.filter((child) => child.type !== 'image');
  const first = children[0];
  const last = children[children.length - 1];
  // Spaces just inside the tags still separate words outside them.
  const pieces = [];
  if (first && first.type === 'text' && /^\s/.test(first.value)) pieces.push({ kind: 'plain', value: ' ' });

  const onlyText = children.every((child) => child.type === 'text' || child.type === 'break');
  const core = onlyText
    ? children.map((child) => (child.type === 'text' ? child.value : ' ')).join('').trim()
    : '';
  if (core && [...core].every((ch) => map[ch])) {
    pieces.push({ kind: 'plain', value: [...core].map((ch) => map[ch]).join('') });
  } else {
    const inner = latexForTextCell(children);
    if (inner) {
      pieces.push({ kind: 'math', value: `\\({}${token.kind === 'sup' ? '^' : '_'}{${inner}}\\)` });
    }
  }

  if (last && last.type === 'text' && /\s$/.test(last.value)) pieces.push({ kind: 'plain', value: ' ' });
  return pieces;
}

function renderLines(tokens, images, useMarkers) {
  const lines = [];
  let current = [];
  let prefix = null;

  const flush = () => {
    // Merge neighbouring plain pieces so whitespace collapses across them.
    const merged = [];
    current.forEach((piece) => {
      const last = merged[merged.length - 1];
      if (piece.kind === 'plain' && last && last.kind === 'plain') last.value += piece.value;
      else merged.push({ ...piece });
    });
    merged.forEach((piece) => {
      if (piece.kind === 'plain') piece.value = piece.value.replace(WHITESPACE, ' ');
    });
    if (merged.length && merged[0].kind === 'plain') merged[0].value = merged[0].value.trimStart();
    const last = merged[merged.length - 1];
    if (last && last.kind === 'plain') last.value = last.value.trimEnd();
    const line = merged.filter((piece) => piece.value !== '');
    if (line.length) {
      if (prefix) line.unshift({ kind: 'plain', value: prefix });
      lines.push(line);
      prefix = null;
    }
    current = [];
  };

  const renderToken = (token) => {
    switch (token.type) {
      case 'text':
        current.push({ kind: 'plain', value: token.value });
        break;
      case 'math':
        if (token.display) {
          flush();
          current.push({ kind: 'math', value: `\\[${token.latex}\\]` });
          flush();
        } else {
          current.push({ kind: 'math', value: `\\(${token.latex}\\)` });
        }
        break;
      case 'script':
        current.push(...renderScript(token));
        // An image inside a super/subscript is still an image; place it after.
        collectImages(token.children).forEach(renderToken);
        break;
      case 'break':
        flush();
        break;
      case 'prefix':
        flush();
        prefix = token.value;
        break;
      case 'image':
        if (useMarkers) current.push({ kind: 'plain', value: ` (${images[token.index].marker}) ` });
        break;
      default:
        break;
    }
  };

  tokens.forEach(renderToken);
  flush();
  return lines;
}

// Makes the final pieces safe for RichText, which finds [SMILES] tags first and
// then hands the text to KaTeX auto-render (delimiters $$ $ \( \[).
function neutraliseText(lines) {
  const pieces = lines.flat();
  const plainPieces = pieces.filter((piece) => piece.kind === 'plain');
  const dollars = plainPieces.reduce((sum, piece) => sum + (piece.value.match(/\$/g) || []).length, 0);
  const hasMath = pieces.some((piece) => piece.kind === 'math' || TYPED_MATH.test(piece.value));
  // Two dollar signs would make RichText render the text between them as math.
  // One is shown as is, unless the field has math: auto-render stops at a "$"
  // it cannot close, so every \( \) and \[ \] after it would show as source.
  const escapeDollars = dollars >= 2 || (dollars === 1 && hasMath);
  pieces.forEach((piece) => {
    if (piece.kind === 'math') {
      // "[{}SMILES]" renders as "[SMILES]" in KaTeX but is no longer a tag.
      piece.value = piece.value.replace(SMILES_TAG, '[{}$1');
      return;
    }
    if (escapeDollars) piece.value = piece.value.replace(/\$/g, '\\(\\$\\)');
    piece.value = piece.value.replace(SMILES_TAG, '[\u200B$1');
  });
}

/**
 * Convert one Canvas HTML field (a mattext with texttype text/html).
 *
 * @param {string} html  the field's HTML, already XML-decoded once
 * @param {{ imageMarkers?: 'auto'|'never' }} [options]
 *   'auto': when there are several images, or text after the image, each
 *   image's place in the text becomes "(Image N)". 'never': images are always
 *   just removed from the text (answer options, where one image is the answer).
 * @returns {{ text: string,
 *   images: { src: string, alt: string, kind: 'bundled'|'remote'|'data'|'other', marker: string|null }[],
 *   warnings: { code: string, message: string }[] }}
 */
function convertCanvasHtml(html, { imageMarkers = 'auto' } = {}) {
  if (typeof html !== 'string' || !html.trim()) return { text: '', images: [], warnings: [] };
  if (html.length > MAX_FIELD_CHARS) return { text: '', images: [], warnings: [makeWarning('too-long')] };

  // One linear pass before any parsing.
  let tags = 0;
  for (let i = html.indexOf('<'); i !== -1; i = html.indexOf('<', i + 1)) {
    tags += 1;
    if (tags > MAX_FIELD_TAGS) return { text: '', images: [], warnings: [makeWarning('too-complex')] };
  }

  // Line endings normalised and NUL dropped, as parse5 did (htmlparser2 keeps
  // both, and "\r" would reach equation LaTeX taken from attributes).
  const source = html.replace(/\r\n?/g, '\n').replace(/\0/g, '');
  const root = cheerio.load(source, PARSE_OPTIONS, false).root()[0];
  const ctx = {
    images: [],
    warnings: [],
    inPre: false,
    depth: { n: 0 },
    tableLatex: { used: 0, limit: TABLE_LATEX_PER_HTML_CHAR * source.length },
  };
  const tokens = [];
  root.children.forEach((node) => walkNode(node, tokens, ctx));

  const useMarkers = imageMarkers !== 'never'
    && (ctx.images.length >= 2 || (ctx.images.length === 1 && hasContentAfterFirstImage(tokens)));
  if (useMarkers) {
    ctx.images.forEach((image, i) => {
      image.marker = `Image ${i + 1}`;
    });
  }

  const lines = renderLines(tokens, ctx.images, useMarkers);
  neutraliseText(lines);
  const text = lines.map((line) => line.map((piece) => piece.value).join('')).join('\n').trim();
  return { text, images: ctx.images, warnings: ctx.warnings };
}

/**
 * Convert a mattext with texttype text/plain. No HTML parsing: real plain
 * options contain a literal "<" or ">", which a parser would eat as a tag.
 */
function convertCanvasPlainText(text) {
  if (typeof text !== 'string') return { text: '', images: [], warnings: [] };
  if (text.length > MAX_FIELD_CHARS) return { text: '', images: [], warnings: [makeWarning('too-long')] };
  const lines = text
    .split(/\r\n|\r|\n/)
    .map((line) => line.replace(WHITESPACE, ' ').trim())
    .filter((line) => line !== '')
    .map((line) => [{ kind: 'plain', value: line }]);
  neutraliseText(lines);
  return { text: lines.map((line) => line[0].value).join('\n'), images: [], warnings: [] };
}

module.exports = {
  convertCanvasHtml,
  convertCanvasPlainText,
  CANVAS_HTML_WARNINGS: WARNINGS,
};
