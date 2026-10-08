/**
 * Canvas Classic Quizzes (as read by canvas-qti-parse.js) -> GRASP question
 * drafts (#140). Decides what GRASP can import, how, and why not.
 *
 * Each Canvas group ("pick 1 of 3") and each question outside a group is one
 * slot. The service makes one parent objective (with one granular of the same
 * name) per slot and puts every imported variant on it, so spaced delivery
 * serves one variant per slot and keeps the others for repetition.
 *
 * Drafts carry the image references separately (stemImages, optionImages):
 * remote srcs hold Canvas's `verifier` token, which is a credential, so the
 * payload that saveQuestion logs never contains a URL. The service fetches or
 * unpacks each image and attaches it.
 *
 * Pure and deterministic: answer options are shuffled with a PRNG seeded from
 * the Canvas item ident, so importing the same export twice gives the same
 * letters.
 */

const cheerio = require('cheerio');
const { convertCanvasHtml, convertCanvasPlainText } = require('./canvas-qti-html');
const { CANVAS_QUESTION_TYPES, PARSE_WARNINGS } = require('./canvas-qti-parse');
const { MC_OPTION_KEYS, MC_MIN_OPTIONS, MC_MAX_OPTIONS } = require('./mc-options');
const { QUESTION_TYPES } = require('../constants/app-constants');

const SOURCE_KIND = 'canvas-classic';
// Every variant of a slot gets the same level: phase 1 serves the lowest level
// first, so mixed levels would always serve the same variant.
const BLOOM = 'Understand';
const MC_STEM = 'Select the best answer:';
const BLANK = '_________';
// The blank where it falls inside converted math (a table, a LaTeX
// super/subscript, an equation): KaTeX refuses a raw "_" there, in \text{} and
// in math alike, and then shows the whole span as red source. \verb renders
// the underscores as they are, and the stem still holds the nine underscores
// GRASP's editors look for.
const BLANK_IN_MATH = `\\verb|${BLANK}|`;
const DEFAULT_TIME_LIMIT_MINUTES = 60;
const NAME_SEPARATOR = ' – ';

// Skip reasons with fixed wording (user-facing sentences).
const SKIP_REASONS = Object.freeze({
  NEW_QUIZZES: "New Quizzes exports aren't supported yet (#147).",
  QUESTION_BANK:
    "This group draws questions from a question bank, which a quiz export doesn't include. Import the bank's questions separately when that's supported.",
  CALCULATED: 'Formula question with variables. These come in a later update (#130).',
  MULTIPLE_ANSWERS: "Multiple-answer questions aren't supported in GRASP yet.",
  MULTIPLE_DROPDOWNS: "Multiple-dropdown questions aren't supported in GRASP.",
  MATCHING: "Matching questions aren't supported in GRASP.",
  ESSAY: "Essay questions aren't imported yet: GRASP needs a sample answer and grading criteria for them.",
  FILE_UPLOAD: "File-upload questions aren't supported in GRASP.",
  TEXT_ONLY: 'Text-only item with no question to answer.',
  NO_TEXT: 'The question has no text.',
  EMPTY_OPTION: 'An answer option is empty.',
  DUPLICATE_CHOICE_IDS: 'Two answer options share the same Canvas answer id, so the correct one cannot be told apart.',
  NO_CORRECT_ANSWER: 'No correct answer is set.',
  SEVERAL_NUMERIC_ANSWERS:
    'Canvas accepts several different answers; GRASP numerical questions take one answer and one tolerance.',
  NOT_A_NUMBER: "The answer isn't a number.",
  ONE_BOUND: 'Only one bound of the answer range is set.',
  EMPTY_RANGE: "The answer range's lowest value is above its highest value.",
});

const UNSUPPORTED_TYPE_REASONS = {
  [CANVAS_QUESTION_TYPES.CALCULATED]: SKIP_REASONS.CALCULATED,
  [CANVAS_QUESTION_TYPES.MULTIPLE_ANSWERS]: SKIP_REASONS.MULTIPLE_ANSWERS,
  [CANVAS_QUESTION_TYPES.MULTIPLE_DROPDOWNS]: SKIP_REASONS.MULTIPLE_DROPDOWNS,
  [CANVAS_QUESTION_TYPES.MATCHING]: SKIP_REASONS.MATCHING,
  [CANVAS_QUESTION_TYPES.ESSAY]: SKIP_REASONS.ESSAY,
  [CANVAS_QUESTION_TYPES.FILE_UPLOAD]: SKIP_REASONS.FILE_UPLOAD,
  [CANVAS_QUESTION_TYPES.TEXT_ONLY]: SKIP_REASONS.TEXT_ONLY,
};

// Draft warnings: each one means the instructor should check the question,
// so it is saved as Draft.
const DRAFT_WARNINGS = Object.freeze({
  CASE_ONLY_OPTIONS:
    "Two answer options differ only in capital letters; GRASP's editor asks you to change one before you can save edits.",
  IDENTICAL_OPTIONS: 'Two answer options are identical.',
  FEEDBACK_DROPPED: 'Canvas feedback was not imported (GRASP has no feedback for this question type).',
  FEEDBACK_IMAGES: 'Images in Canvas feedback were not imported (GRASP feedback is text only).',
  BLANK_REPEATED: 'The blank appears more than once in the question; GRASP takes one answer for all of them.',
  RANGE_WIDENED:
    "Canvas accepted the exact answer or a range that doesn't include it; GRASP accepts everything between the two.",
});

// Option texts that refer to other options by position: shuffling would
// break them, so the question keeps Canvas's order. A false match only keeps
// the instructor's order, so these lean wide: "all the above", "none of the
// other answers above", "both (A) and (B)", "a, b, and c", "neither a nor b".
const OPTION_REFERENCES = [
  /\b(all|none|both|neither)\s+(of\s+)?(the\s+)?((other\s+)?(answers?|options?|choices?|responses?)\s+)?(above|below|these)\b/i,
  /\(?\b[a-h]\)?(\s*,\s*(and\s+|or\s+)?|\s+(and|or|nor|&)\s+)\(?[a-h]\b\)?/i,
  /\boption\s+[A-H]\b/i,
];

// An option that is only a letter ("A", "(b)", "C.", "d)") names a label in
// the question, usually on its picture. GRASP shows its own letter beside
// every option, so a question with such an option is never shuffled: each
// bare letter sits at its own letter, and the other options ("Both", "Cannot
// be determined", a picture) take the letters left over, in Canvas order.
const BARE_LABEL = /^\(?([a-h])\)?[.)]?$/i;

// A "$" the converter left as is: one in a field with no math. It writes
// every other dollar as \$ (inside math) or \(\$\).
const LONE_DOLLAR = /(?<!\\)\$/g;
// Math that KaTeX auto-render finds in converted text, including \(\$\).
const MATH_DELIMITER = /\\[([]/;

// RichText turns [SMILES]...[/SMILES] into a <canvas> and trusts what is
// inside. canvas-qti-html breaks the tag in everything it converts; Canvas
// titles, accepted answers and alt texts do not go through it, so they are
// broken here the same way (U+200B after the "[").
const SMILES_TAG = /\[(\/?smiles\])/gi;

// Canvas alt text is usually a filename ("AnsOpt.jpg", "1.png"), which says
// nothing and can even name the answer.
const FILENAME_LIKE = [/\.(png|jpe?g|gif|webp|bmp|svg|tiff?)$/i, /^[\w-]{1,40}$/];
const URL_LIKE = /\b(https?:\/\/|www\.)|\$IMS-CC-FILEBASE\$|%24IMS-CC-FILEBASE%24/i;
const IMAGE_MARKER = /\(Image \d+\)/g;
const FILEBASE = '$IMS-CC-FILEBASE$';

// ---- Small helpers ------------------------------------------------------------

function collapse(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

// Canvas text used as is (titles, accepted answers, alt texts): whitespace
// collapsed and any [SMILES] tag broken.
function plainText(value) {
  return collapse(value).replace(SMILES_TAG, '[\u200B$1');
}

// canvas-qti-html's warning messages are fragments; give them a full stop.
function asSentence(text) {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function pushUnique(list, values) {
  for (const value of values) {
    if (value && !list.includes(value)) list.push(value);
  }
  return list;
}

function located(where, result) {
  return result.warnings.map((warning) => `${where}: ${asSentence(warning.message)}`);
}

function nameRegistry() {
  return { used: new Set(), next: new Map() };
}

// "X", then "X (2)", "X (3)" ... compared without case, as objective names are.
// `next` remembers, per base, the first suffix not yet tried: names are only
// ever added, so every suffix below it is still taken. Without it, many slots
// sharing one title would cost O(n^2) on the main thread.
function uniqueName(base, registry) {
  const { used, next } = registry;
  let name = base;
  if (used.has(name.toLowerCase())) {
    const key = base.toLowerCase();
    let n = next.get(key) || 2;
    // used.has still decides: a group titled "X (3)" makes "X" skip that name.
    for (name = `${base} (${n})`; used.has(name.toLowerCase()); name = `${base} (${n})`) n += 1;
    next.set(key, n + 1);
  }
  used.add(name.toLowerCase());
  return name;
}

// A short descriptive alt text, or "" for filenames, LaTeX alts and anything
// carrying a link.
function descriptiveAlt(alt) {
  const text = plainText(alt);
  if (!text || /^latex:/i.test(text) || URL_LIKE.test(text)) return '';
  if (FILENAME_LIKE.some((pattern) => pattern.test(text))) return '';
  return text;
}

function convertField(value, texttype, imageMarkers) {
  return texttype === 'text/plain'
    ? convertCanvasPlainText(value)
    : convertCanvasHtml(value, { imageMarkers });
}

// Classic exports write UTC without a zone, New Quizzes add "Z". Normalised to
// one ISO form so dates compare as strings; parsing a fixed string is still
// deterministic.
const ISO_WITHOUT_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;
function normalizeCanvasDate(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return null;
  const ms = Date.parse(ISO_WITHOUT_ZONE.test(text) ? `${text}Z` : text);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

// ---- Seeded shuffle -------------------------------------------------------------

// 32-bit FNV-1a over the UTF-8 bytes.
function fnv1a32(text) {
  let hash = 0x811c9dc5;
  for (const byte of Buffer.from(String(text), 'utf8')) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Fisher-Yates over the indexes 0..n-1.
function seededOrder(n, seedText) {
  const random = mulberry32(fnv1a32(seedText));
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

// ---- Decimal arithmetic for numerical answers ----------------------------------
//
// Canvas writes answers and bounds as decimal strings. Float subtraction turns
// a 0.2 margin into 0.2000000000000455, which the student hint would print, so
// margins are computed on BigInt mantissas instead: { coef, scale } means
// coef / 10^scale.

const DECIMAL = /^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i;

function parseDecimal(raw) {
  // A typographic minus (U+2212) reads as "-".
  const text = String(raw).trim().replace(/^\u2212/, '-');
  // Far longer than any real answer; keeps BigInt work bounded.
  if (!text || text.length > 100) return null;
  const match = text.match(DECIMAL);
  if (!match || !(match[2] || match[3])) return null;
  const fraction = match[3] || '';
  const exponent = match[4] ? Number(match[4]) : 0;
  if (Math.abs(exponent) > 400) return null;
  let coef = BigInt(`${match[2] || ''}${fraction}` || '0');
  let scale = fraction.length - exponent;
  if (scale < 0) {
    coef *= 10n ** BigInt(-scale);
    scale = 0;
  }
  return { coef: match[1] === '-' ? -coef : coef, scale, written: fraction.length };
}

function normalizeDecimal({ coef, scale }) {
  let c = coef;
  let s = scale;
  while (s > 0 && c % 10n === 0n) {
    c /= 10n;
    s -= 1;
  }
  return { coef: c, scale: s };
}

function aligned(a, b) {
  const scale = Math.max(a.scale, b.scale);
  return [a.coef * 10n ** BigInt(scale - a.scale), b.coef * 10n ** BigInt(scale - b.scale), scale];
}

function subtract(a, b) {
  const [x, y, scale] = aligned(a, b);
  return normalizeDecimal({ coef: x - y, scale });
}

function compareDecimals(a, b) {
  const [x, y] = aligned(a, b);
  if (x === y) return 0;
  return x < y ? -1 : 1;
}

function midpoint(a, b) {
  const [x, y, scale] = aligned(a, b);
  const sum = x + y;
  // sum / 2 is sum * 5 / 10, which stays exact.
  return normalizeDecimal(sum % 2n === 0n ? { coef: sum / 2n, scale } : { coef: sum * 5n, scale: scale + 1 });
}

function plainString(value) {
  const { coef, scale } = normalizeDecimal(value);
  const negative = coef < 0n;
  let digits = (negative ? -coef : coef).toString();
  if (scale > 0) {
    digits = digits.padStart(scale + 1, '0');
    digits = `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  }
  return negative ? `-${digits}` : digits;
}

// The formula GRASP stores: no trailing zeros, e-notation ("1.5e-7") when the
// plain form would need more than 15 digits. Returns the decimals it shows.
function canonicalDecimal(value) {
  const plain = plainString(value);
  if (plain.replace(/[^0-9]/g, '').length <= 15) {
    const point = plain.indexOf('.');
    return { text: plain, decimals: point === -1 ? 0 : plain.length - point - 1 };
  }
  const { coef, scale } = normalizeDecimal(value);
  const negative = coef < 0n;
  const digits = (negative ? -coef : coef).toString();
  const significant = digits.replace(/0+$/, '') || '0';
  const exponent = digits.length - 1 - scale;
  const mantissa = significant.length > 1 ? `${significant[0]}.${significant.slice(1)}` : significant;
  return { text: `${negative ? '-' : ''}${mantissa}e${exponent}`, decimals: significant.length - 1 };
}

// Numerical answer -> { formula, tolerance, decimals, warnings } or { skip }.
function mapNumericAnswer({ exact, min, max }) {
  const values = { exact, min, max };
  const parsed = {};
  for (const [key, raw] of Object.entries(values)) {
    if (raw === null || raw === undefined) continue;
    parsed[key] = parseDecimal(raw);
    if (!parsed[key]) return { skip: SKIP_REASONS.NOT_A_NUMBER };
  }
  const hasMin = Boolean(parsed.min);
  const hasMax = Boolean(parsed.max);
  if (hasMin !== hasMax) return { skip: SKIP_REASONS.ONE_BOUND };
  if (!parsed.exact && !hasMin) return { skip: SKIP_REASONS.NO_CORRECT_ANSWER };
  if (hasMin && compareDecimals(parsed.min, parsed.max) > 0) return { skip: SKIP_REASONS.EMPTY_RANGE };

  const warnings = [];
  let tolerance;
  let margin = null;
  if (!hasMin) {
    tolerance = { mode: 'absolute', value: 0 };
  } else if (!parsed.exact) {
    tolerance = { mode: 'range', min: Number(plainString(parsed.min)), max: Number(plainString(parsed.max)) };
  } else {
    const below = subtract(parsed.exact, parsed.min);
    const above = subtract(parsed.max, parsed.exact);
    // min <= max here, so equal margins are never negative.
    if (compareDecimals(below, above) === 0) {
      margin = below;
      tolerance = { mode: 'absolute', value: Number(plainString(margin)) };
    } else {
      // Canvas accepts "exact OR within the range"; GRASP has one rule, so a
      // range that leaves the exact answer out is widened to include it.
      let low = parsed.min;
      let high = parsed.max;
      if (compareDecimals(parsed.exact, low) < 0) low = parsed.exact;
      if (compareDecimals(parsed.exact, high) > 0) high = parsed.exact;
      if (low !== parsed.min || high !== parsed.max) warnings.push(DRAFT_WARNINGS.RANGE_WIDENED);
      tolerance = { mode: 'range', min: Number(plainString(low)), max: Number(plainString(high)) };
    }
  }

  const answer = parsed.exact || midpoint(parsed.min, parsed.max);
  const formula = canonicalDecimal(answer);
  const numbers = [Number(formula.text), tolerance.value, tolerance.min, tolerance.max].filter((n) => n !== undefined);
  if (!numbers.every(Number.isFinite)) return { skip: SKIP_REASONS.NOT_A_NUMBER };

  // Shown decimals: as many as the author wrote anywhere, so 0.0123 is not
  // displayed as 0.01. They do not affect grading in absolute or range mode.
  const decimals = Math.min(12, Math.max(
    formula.decimals,
    margin ? canonicalDecimal(margin).decimals : 0,
    ...Object.values(parsed).map((value) => value.written),
  ));
  return { formula: formula.text, tolerance, decimals, warnings };
}

// ---- Stems ------------------------------------------------------------------------

function isBlankText(node) {
  return node.type === 'text' && !node.data.trim();
}

function soleElementChild(node) {
  const children = (node.children || []).filter((child) => !isBlankText(child));
  return children.length === 1 && children[0].type === 'tag' ? children[0] : null;
}

function nextElementSibling(node) {
  let next = node.next;
  while (next && (isBlankText(next) || next.type === 'comment')) next = next.next;
  return next && next.type === 'tag' ? next : null;
}

function normalizedSrc(src) {
  return String(src || '').trim().replace(/^%24IMS-CC-FILEBASE%24/i, FILEBASE);
}

// GRASP's own QTI export writes each stem image as <p><img alt="caption"></p>
// followed by a visible <p><em>caption</em></p>. Canvas students saw that
// paragraph under the image, which is exactly where GRASP shows an image
// caption, so it moves back to the caption instead of becoming stem text
// after an "(Image 1)" marker. Only that exact pattern is touched (the
// paragraph must repeat the alt text), and the HTML is left as written when
// nothing matches.
function liftExportedCaptions(html) {
  if (typeof html !== 'string' || !/<em[\s>]/i.test(html) || !/<img[\s>]/i.test(html)) {
    return { html, captions: [] };
  }
  const $ = cheerio.load(html, null, false);
  const captions = [];
  $('img').each((_, img) => {
    const classes = String(img.attribs.class || '').split(/\s+/);
    const alt = collapse(img.attribs.alt);
    const holder = img.parent;
    if (!alt || classes.includes('equation_image')) return;
    if (!holder || holder.type !== 'tag' || holder.name !== 'p' || soleElementChild(holder) !== img) return;
    const next = nextElementSibling(holder);
    const em = next && next.name === 'p' ? soleElementChild(next) : null;
    if (!em || em.name !== 'em' || collapse($(em).text()) !== alt) return;
    $(next).remove();
    captions.push({ src: normalizedSrc(img.attribs.src), caption: plainText(alt) });
  });
  return captions.length ? { html: $.html(), captions } : { html, captions };
}

// The stem as GRASP text plus its images, in order. A stem that is only
// images (or only their markers) gets a short prompt instead.
function convertStem(item) {
  const plain = item.stemTexttype === 'text/plain';
  const { html, captions } = plain ? { html: item.stemHtml, captions: [] } : liftExportedCaptions(item.stemHtml);
  const result = convertField(html, item.stemTexttype, 'auto');
  const images = result.images.map((image) => {
    const lifted = captions.findIndex((entry) => entry.src === image.src);
    const caption = lifted === -1 ? '' : captions.splice(lifted, 1)[0].caption;
    let label = image.marker || '';
    if (caption) label = label ? `${label}: ${caption}` : caption;
    return { src: image.src, kind: image.kind, caption: label, altText: descriptiveAlt(image.alt) };
  });
  let { text } = result;
  if (images.length && !text.replace(IMAGE_MARKER, '').trim()) {
    text = images.length === 1 ? 'Use the image below to answer.' : 'Use the images below to answer.';
  }
  return { text, images, warnings: located('Question text', result) };
}

// ---- Item mappers ------------------------------------------------------------------

function hasFeedback(item) {
  const { general, correct, incorrect } = item.feedbackHtml;
  return Boolean(general || correct || incorrect || Object.keys(item.choiceFeedbackHtml).length);
}

// The Canvas item title when it says something; otherwise the slot name.
function questionTitle(item, slot) {
  const title = plainText(item.title);
  if (!title || /^(question|q)\s*\d*$/i.test(title)) return slot.name;
  if (title.toLowerCase() === slot.groupTitle.toLowerCase()) return slot.name;
  return title;
}

function convertFeedback(html, warnings) {
  if (!html) return '';
  const result = convertCanvasHtml(html, { imageMarkers: 'never' });
  pushUnique(warnings, located('Feedback', result));
  if (result.images.length) pushUnique(warnings, [DRAFT_WARNINGS.FEEDBACK_IMAGES]);
  return result.text;
}

// Separately converted fields as one text, a blank line between them.
// canvas-qti-html makes "$" safe one field at a time and leaves a single "$"
// as is when its field has no math. Joined, two of them would make RichText
// show the text between them as math, and one before another field's math
// stops auto-render there, so the converter's rule runs again over the whole:
// two or more lone "$", or one plus any math, are written as \(\$\).
function joinConvertedFields(fields) {
  const parts = fields.filter(Boolean);
  const text = parts.join('\n\n');
  if (parts.length < 2) return text;
  const dollars = (text.match(LONE_DOLLAR) || []).length;
  if (dollars >= 2 || (dollars === 1 && MATH_DELIMITER.test(text))) {
    return text.replace(LONE_DOLLAR, '\\(\\$\\)');
  }
  return text;
}

function keepsCanvasOrder(item, quiz, texts) {
  if (item.questionType === CANVAS_QUESTION_TYPES.TRUE_FALSE) return true;
  if (quiz.meta && quiz.meta.shuffleAnswers === false) return true;
  // An MC written as true/false reads oddly as "False, True".
  const lower = texts.map((text) => text.toLowerCase()).sort();
  if (lower.length === 2 && lower[0] === 'false' && lower[1] === 'true') return true;
  return texts.some((text) => OPTION_REFERENCES.some((pattern) => pattern.test(text)));
}

// Options where at least one is a bare letter: each bare letter at its own
// letter, the other options (an image-only option has no text, so it is one
// of them) in the letters left over, in Canvas order. A letter that repeats,
// or that the options do not reach ("E" of two options, as in an E/Z isomer
// answer), keeps Canvas order instead. null when no option is a bare letter.
function labelOrder(texts) {
  const labels = texts.map((text) => {
    const match = text.match(BARE_LABEL);
    return match ? match[1].toUpperCase() : null;
  });
  if (labels.every((label) => label === null)) return null;
  const canvasOrder = texts.map((_, i) => i);
  const keys = MC_OPTION_KEYS.slice(0, texts.length);
  const order = keys.map(() => -1);
  for (let i = 0; i < labels.length; i += 1) {
    if (labels[i] === null) continue;
    const position = keys.indexOf(labels[i]);
    if (position === -1 || order[position] !== -1) return canvasOrder;
    order[position] = i;
  }
  const others = canvasOrder.filter((i) => labels[i] === null);
  return order.map((index) => (index === -1 ? others.shift() : index));
}

// Canvas indexes in GRASP letter order.
function optionOrder(item, quiz, texts) {
  const byLabel = labelOrder(texts);
  if (byLabel) return byLabel;
  if (keepsCanvasOrder(item, quiz, texts)) return texts.map((_, i) => i);
  return seededOrder(texts.length, item.ident);
}

function mapChoiceItem(item, slot, quiz) {
  const { choices } = item;
  if (choices.length < MC_MIN_OPTIONS || choices.length > MC_MAX_OPTIONS) {
    return { skip: `GRASP multiple choice needs ${MC_MIN_OPTIONS} to ${MC_MAX_OPTIONS} answer options; this one has ${choices.length}.` };
  }
  if (new Set(choices.map((choice) => choice.ident)).size !== choices.length) {
    return { skip: SKIP_REASONS.DUPLICATE_CHOICE_IDS };
  }
  const correctCount = item.correctChoiceIdents.length;
  if (correctCount !== 1) {
    return {
      skip: correctCount === 0
        ? 'Canvas marks no answer as correct; GRASP multiple choice needs exactly one.'
        : `Canvas marks ${correctCount} answers as correct; GRASP multiple choice needs exactly one.`,
    };
  }
  const stem = convertStem(item);
  if (!stem.text) return { skip: SKIP_REASONS.NO_TEXT };

  const options = choices.map((choice) => {
    const result = convertField(choice.text, choice.texttype, 'never');
    return { ident: choice.ident, text: result.text, images: result.images, result };
  });
  if (options.some((option) => !option.text && option.images.length === 0)) {
    return { skip: SKIP_REASONS.EMPTY_OPTION };
  }

  const order = optionOrder(item, quiz, options.map((option) => option.text));

  const feedbackWarnings = [];
  const general = convertFeedback(item.feedbackHtml.general, feedbackWarnings);
  const whenCorrect = convertFeedback(item.feedbackHtml.correct, feedbackWarnings);
  const whenIncorrect = convertFeedback(item.feedbackHtml.incorrect, feedbackWarnings);

  const warnings = [...stem.warnings];
  const payloadOptions = {};
  const optionImages = {};
  let correctAnswer = null;
  order.forEach((index, position) => {
    const option = options[index];
    const letter = MC_OPTION_KEYS[position];
    const isCorrect = option.ident === item.correctChoiceIdents[0];
    if (isCorrect) correctAnswer = letter;
    const feedback = joinConvertedFields([
      convertFeedback(item.choiceFeedbackHtml[option.ident], feedbackWarnings),
      isCorrect ? whenCorrect : whenIncorrect,
      general,
    ]);
    payloadOptions[letter] = { text: option.text, feedback };

    pushUnique(warnings, located(`Option ${letter}`, option.result));
    const [image, ...extra] = option.images;
    if (image) optionImages[letter] = { src: image.src, kind: image.kind, caption: descriptiveAlt(image.alt) };
    if (extra.length) {
      pushUnique(warnings, [`Option ${letter}: Only the first of its ${option.images.length} images was kept.`]);
    }
  });

  // Images become separate uploads, so only options with the same picture
  // source can look alike to a student; the editor compares text alone when
  // neither option has an image.
  const seen = new Map();
  const seenLower = new Map();
  order.forEach((index) => {
    const option = options[index];
    const src = option.images[0] ? option.images[0].src : '';
    const key = `${src}\n${option.text}`;
    if (seen.has(key)) pushUnique(warnings, [DRAFT_WARNINGS.IDENTICAL_OPTIONS]);
    seen.set(key, true);
    if (src) return;
    const lower = option.text.toLowerCase();
    if (seenLower.has(lower) && seenLower.get(lower) !== option.text) {
      pushUnique(warnings, [DRAFT_WARNINGS.CASE_ONLY_OPTIONS]);
    }
    if (!seenLower.has(lower)) seenLower.set(lower, option.text);
  });
  pushUnique(warnings, feedbackWarnings);
  pushUnique(warnings, item.rawWarnings);

  return {
    draft: {
      payload: {
        questionType: QUESTION_TYPES.MULTIPLE_CHOICE,
        title: stem.text,
        stem: MC_STEM,
        bloom: BLOOM,
        options: payloadOptions,
        correctAnswer,
      },
      stemImages: stem.images,
      optionImages,
      warnings,
    },
  };
}

// Warnings shared by the types that have no feedback field. A numerical or
// blank answer comment only shows up as the parser's FEEDBACK_NOT_READ, which
// this one sentence replaces.
function noFeedbackWarnings(item) {
  const warnings = [];
  const unread = item.rawWarnings.includes(PARSE_WARNINGS.FEEDBACK_NOT_READ);
  if (hasFeedback(item) || unread) warnings.push(DRAFT_WARNINGS.FEEDBACK_DROPPED);
  return pushUnique(warnings, item.rawWarnings.filter((w) => w !== PARSE_WARNINGS.FEEDBACK_NOT_READ));
}

function mapNumericalItem(item, slot) {
  if (item.numericAnswers.length === 0) return { skip: SKIP_REASONS.NO_CORRECT_ANSWER };
  if (item.numericAnswers.length > 1) return { skip: SKIP_REASONS.SEVERAL_NUMERIC_ANSWERS };
  const answer = mapNumericAnswer(item.numericAnswers[0]);
  if (answer.skip) return answer;
  const stem = convertStem(item);
  if (!stem.text) return { skip: SKIP_REASONS.NO_TEXT };

  return {
    draft: {
      payload: {
        questionType: QUESTION_TYPES.CALCULATION,
        title: questionTitle(item, slot),
        // A fixed-answer stem may not contain "{{name}}" (save validation
        // reads it as a variable); LaTeX can produce one, so split the braces.
        stem: stem.text.replace(/\{(?=\{)/g, '{ ').replace(/\}(?=\})/g, '} '),
        bloom: BLOOM,
        calculationFormula: answer.formula,
        calculationVariables: [],
        calculationAnswerDecimals: answer.decimals,
        calculationTolerance: answer.tolerance,
      },
      stemImages: stem.images,
      optionImages: {},
      warnings: pushUnique([...stem.warnings, ...answer.warnings], noFeedbackWarnings(item)),
    },
  };
}

// Trimmed, whitespace collapsed, empty dropped, de-duplicated ignoring case
// (GRASP grading ignores case anyway); the first spelling wins.
function cleanAnswers(answers) {
  const seen = new Set();
  const out = [];
  for (const answer of answers) {
    const text = plainText(answer);
    if (!text || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    out.push(text);
  }
  return out;
}

// Whether converted text that starts inside math (or not) ends inside a
// \( \) or \[ \] span. A backslash takes the character after it, so "\\" never
// starts a delimiter. The converter closes every span it opens.
function endsInsideMath(text, startsInside) {
  let inside = startsInside;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== '\\') continue;
    const next = text[i + 1];
    if (next === '(' || next === '[') inside = true;
    else if (next === ')' || next === ']') inside = false;
    i += 1;
  }
  return inside;
}

// The stem parts around each blank, joined with the blank: BLANK_IN_MATH where
// the blank falls inside math, BLANK elsewhere.
function joinAtBlanks(parts) {
  let inside = endsInsideMath(parts[0], false);
  let text = parts[0];
  for (const part of parts.slice(1)) {
    text += (inside ? BLANK_IN_MATH : BLANK) + part;
    inside = endsInsideMath(part, inside);
  }
  return text;
}

// blankId: the Canvas blank name for fill-in-multiple-blanks ("x1" for the
// literal "[x1]" in the stem), or null for a short-answer question.
function mapFillInItem(item, slot, rawAnswers, blankId) {
  const answers = cleanAnswers(rawAnswers);
  if (answers.length === 0) return { skip: SKIP_REASONS.NO_CORRECT_ANSWER };
  const stem = convertStem(item);
  if (!stem.text) return { skip: SKIP_REASONS.NO_TEXT };

  const warnings = [...stem.warnings];
  let { text } = stem;
  if (blankId !== null) {
    // Only the declared blank: chemistry stems are full of "[A]" and "[H+]".
    // The converter broke a blank named "smiles" like any [SMILES] tag, so it
    // is looked for in that form.
    const parts = text.split(`[${blankId}]`.replace(SMILES_TAG, '[\u200B$1'));
    if (parts.length > 2) warnings.push(DRAFT_WARNINGS.BLANK_REPEATED);
    text = parts.length > 1 ? joinAtBlanks(parts) : `${text} ${BLANK}`;
  } else if (!text.includes(BLANK)) {
    text = `${text} ${BLANK}`;
  }

  return {
    draft: {
      payload: {
        questionType: QUESTION_TYPES.FILL_IN_THE_BLANK,
        title: questionTitle(item, slot),
        stem: text,
        bloom: BLOOM,
        correctAnswer: answers[0],
        acceptableAnswers: answers,
      },
      stemImages: stem.images,
      optionImages: {},
      warnings: pushUnique(warnings, noFeedbackWarnings(item)),
    },
  };
}

function mapItem(item, slot, quiz) {
  if (quiz.flavour === 'new-quizzes') return { skip: SKIP_REASONS.NEW_QUIZZES };
  const type = item.questionType;
  switch (type) {
    case CANVAS_QUESTION_TYPES.MULTIPLE_CHOICE:
    case CANVAS_QUESTION_TYPES.TRUE_FALSE:
      return mapChoiceItem(item, slot, quiz);
    case CANVAS_QUESTION_TYPES.NUMERICAL:
      return mapNumericalItem(item, slot);
    case CANVAS_QUESTION_TYPES.FILL_IN_MULTIPLE_BLANKS:
      if (item.blanks.length !== 1) {
        return { skip: `GRASP fill-in-the-blank questions have one blank; this one has ${item.blanks.length}.` };
      }
      return mapFillInItem(item, slot, item.blanks[0].answers, item.blanks[0].id);
    case CANVAS_QUESTION_TYPES.SHORT_ANSWER:
      return mapFillInItem(item, slot, item.shortAnswers, null);
    default:
      return { skip: UNSUPPORTED_TYPE_REASONS[type] || `Unknown Canvas question type (${type || 'none'}).` };
  }
}

// ---- Slots and quizzes ---------------------------------------------------------------

function mapSlot(parsedSlot, position, quiz, slotNames) {
  const isGroup = parsedSlot.kind === 'group';
  const groupTitle = isGroup ? plainText(parsedSlot.title) : '';
  const label = isGroup ? groupTitle || `Q${String(position).padStart(2, '0')}` : `Question ${position}`;
  const slot = {
    ident: parsedSlot.ident,
    position,
    name: uniqueName(`${quiz.title}${NAME_SEPARATOR}${label}`, slotNames),
    questions: [],
    skipped: [],
    notes: [],
  };
  const context = { name: slot.name, groupTitle };
  const items = isGroup ? parsedSlot.items : [parsedSlot.item];

  if (isGroup && parsedSlot.sourceBankRef && items.length === 0) {
    slot.skipped.push({
      itemIdent: null,
      slotName: slot.name,
      itemTitle: '',
      canvasType: null,
      reason: SKIP_REASONS.QUESTION_BANK,
    });
  }

  for (const item of items) {
    const mapped = mapItem(item, context, quiz);
    if (mapped.skip) {
      slot.skipped.push({
        itemIdent: item.ident,
        slotName: slot.name,
        itemTitle: plainText(item.title),
        canvasType: item.questionType,
        reason: mapped.skip,
      });
      continue;
    }
    slot.questions.push({
      itemIdent: item.ident,
      slotIdent: slot.ident,
      source: { kind: SOURCE_KIND, quizIdent: quiz.ident, itemIdent: item.ident, slotIdent: slot.ident },
      ...mapped.draft,
    });
  }

  if (isGroup && parsedSlot.pick > 1 && slot.questions.length) {
    slot.notes.push(`Canvas picked ${parsedSlot.pick} questions from '${label}'; GRASP gives one question per objective.`);
  }
  // A group's points_per_item overrides its items' own points.
  const imported = new Set(slot.questions.map((question) => question.itemIdent));
  const points = isGroup && parsedSlot.pointsPerItem !== null
    ? [parsedSlot.pointsPerItem]
    : items.filter((item) => imported.has(item.ident)).map((item) => item.pointsPossible);
  const unscored = imported.size > 0 && points.every((value) => value === 0);
  return { slot, label, unscored };
}

// "Q01, Q02 and Q03"
function listLabels(labels) {
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

// What the quiz description loses, as notes: GRASP quiz descriptions are text.
function descriptionNotes(result) {
  const notes = [];
  for (const warning of result.warnings) {
    notes.push(warning.code === 'linked-file'
      ? 'The quiz description linked a file, which was not imported.'
      : `Quiz description: ${asSentence(warning.message)}`);
  }
  if (result.images.length === 1) notes.push('The quiz description had an image, which was not imported.');
  if (result.images.length > 1) {
    notes.push(`The quiz description had ${result.images.length} images, which were not imported.`);
  }
  return notes;
}

function mapQuiz(parsed, position, used) {
  const meta = parsed.meta || {};
  const title = uniqueName(plainText(parsed.title) || 'Untitled quiz', used.titles);
  const quiz = { ident: parsed.ident, title, flavour: parsed.flavour, meta };
  const mapped = (parsed.slots || []).map((slot, i) => mapSlot(slot, i + 1, quiz, used.slotNames));
  const slots = mapped.map((entry) => entry.slot);

  const description = convertCanvasHtml(meta.description || '', { imageMarkers: 'never' });
  const timeLimit = Number(meta.timeLimitMinutes);
  const hasDrafts = slots.some((slot) => slot.questions.length > 0);

  // Description losses only matter when a GRASP quiz can be made.
  const notes = hasDrafts ? descriptionNotes(description) : [];
  const unscored = mapped.filter((entry) => entry.unscored).map((entry) => entry.label);
  if (unscored.length) {
    notes.push(unscored.length === 1
      ? `Canvas gives no points for ${unscored[0]}; in GRASP its questions count like any other.`
      : `Canvas gives no points for ${listLabels(unscored)}; in GRASP their questions count like any other.`);
  }
  slots.forEach((slot) => notes.push(...slot.notes));

  return {
    ident: parsed.ident,
    title,
    flavour: parsed.flavour,
    quizSettings: {
      name: title,
      // Shown as plain text, not through RichText, so a neutralised "$" is
      // written back as itself.
      description: description.text.split('\\(\\$\\)').join('$'),
      timeLimitMinutes: Number.isFinite(timeLimit) && timeLimit > 0 ? Math.ceil(timeLimit) : DEFAULT_TIME_LIMIT_MINUTES,
      disablePreviousNavigation: meta.cantGoBack === true,
    },
    order: {
      dueAt: normalizeCanvasDate(meta.dueAt),
      unlockAt: normalizeCanvasDate(meta.unlockAt),
      position,
    },
    slots,
    skipped: slots.flatMap((slot) => slot.skipped),
    notes,
  };
}

/**
 * Map parsed Canvas quizzes (in manifest order) to GRASP drafts.
 * Quiz titles are made unique across the file ("X", "X (2)") and slot names
 * across every quiz, so no two slots share an objective name.
 *
 * @param {object[]} parsedQuizzes  parseCanvasQuiz results
 * @returns {object[]} MappedQuiz[] in the same order
 */
function mapCanvasQuizzes(parsedQuizzes) {
  if (!Array.isArray(parsedQuizzes)) return [];
  const used = { titles: nameRegistry(), slotNames: nameRegistry() };
  return parsedQuizzes.map((quiz, index) => mapQuiz(quiz, index + 1, used));
}

/**
 * Sort comparator for creating GRASP quizzes in Canvas order: by due date,
 * else unlock date (earliest first); quizzes with neither come after, in
 * manifest order. Unscheduled GRASP quizzes are ordered by createdAt, which
 * decides what counts as an "earlier quiz" in spaced repetition.
 */
function compareQuizCreationOrder(a, b) {
  const keyA = a.order.dueAt || a.order.unlockAt;
  const keyB = b.order.dueAt || b.order.unlockAt;
  if (keyA && keyB && keyA !== keyB) return keyA < keyB ? -1 : 1;
  if (Boolean(keyA) !== Boolean(keyB)) return keyA ? -1 : 1;
  return a.order.position - b.order.position;
}

module.exports = {
  mapCanvasQuizzes,
  compareQuizCreationOrder,
  CANVAS_SKIP_REASONS: SKIP_REASONS,
  CANVAS_DRAFT_WARNINGS: DRAFT_WARNINGS,
};
