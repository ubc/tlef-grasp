/**
 * Canvas Classic Quizzes QTI 1.2 -> an intermediate model (#140).
 *
 * One quiz at a time: the `<questestinterop>` file plus its assessment_meta.xml,
 * as read out of the export zip by canvas-qti-package.js. This module only reads
 * the XML; deciding what GRASP can import (and why not) is canvas-qti-map.js.
 *
 * Things Canvas does that a naive reader gets wrong:
 *   - The question and answer HTML is entity-escaped text inside <mattext>, so it
 *     is decoded exactly once here (by the XML parser) and handed on as HTML.
 *   - Groups ("pick 1 of 3") are <section>s inside root_section; questions outside
 *     a group sit between them, and the order matters for slot numbering.
 *   - The correct answer is the one named by a respcondition that adds score, not
 *     the first <varequal>: per-answer feedback conditions come first.
 *   - Fill-in-multiple-blanks scoring names only the first accepted answer of each
 *     blank; every response_label of a blank is accepted.
 *   - assessment_meta.xml nests an <assignment> with its own <title> and dates, so
 *     only direct children of <quiz> are read.
 */

const cheerio = require('cheerio');
const { CanvasImportError } = require('./canvas-qti-package');

const CANVAS_QUESTION_TYPES = Object.freeze({
  MULTIPLE_CHOICE: 'multiple_choice_question',
  TRUE_FALSE: 'true_false_question',
  MULTIPLE_ANSWERS: 'multiple_answers_question',
  NUMERICAL: 'numerical_question',
  CALCULATED: 'calculated_question',
  FILL_IN_MULTIPLE_BLANKS: 'fill_in_multiple_blanks_question',
  MULTIPLE_DROPDOWNS: 'multiple_dropdowns_question',
  SHORT_ANSWER: 'short_answer_question',
  MATCHING: 'matching_question',
  ESSAY: 'essay_question',
  FILE_UPLOAD: 'file_upload_question',
  TEXT_ONLY: 'text_only_question',
});

// Item.rawWarnings entries. Written as sentences because they describe content
// the import loses or doubts, and may be shown to the instructor as-is.
const PARSE_WARNINGS = Object.freeze({
  DUPLICATE_CHOICE_IDENT: 'Two answer options share the same Canvas answer id.',
  UNKNOWN_CORRECT_CHOICE: 'Canvas scores an answer that is not one of the options.',
  EXTRA_RESPONSE_AREAS: 'The question has more than one answer area; only the first was read.',
  FEEDBACK_NOT_READ: 'Some Canvas feedback could not be matched to an answer and was not imported.',
});

const BLANK_TYPES = new Set([
  CANVAS_QUESTION_TYPES.FILL_IN_MULTIPLE_BLANKS,
  CANVAS_QUESTION_TYPES.MULTIPLE_DROPDOWNS,
]);
// Types whose response_lids are not one list of answer options.
const NON_CHOICE_LID_TYPES = new Set([...BLANK_TYPES, CANVAS_QUESTION_TYPES.MATCHING]);
const GENERAL_FEEDBACK_IDENTS = { general: 'general_fb', correct: 'correct_fb', incorrect: 'general_incorrect_fb' };

// Per-quiz caps. Real quizzes have at most about 110 slots and 69 questions;
// the caps stop a hand-made file with thousands of groups from making every
// later step (naming, mapping, preview, commit) slow on the shared server.
const MAX_SLOTS_PER_QUIZ = 2000;
const MAX_ITEMS_PER_QUIZ = 5000;
// Real exports nest at most 11 elements deep. htmlparser2 (under cheerio) slows
// down with the square of the depth, and the readers below recurse, so a file
// that nests deeper than this is refused before it is parsed.
const MAX_XML_DEPTH = 100;
// The readers take these elements one at a time and walk (and return the text
// of) each one's own subtree, so one nested inside another of the same name
// would be read again for every level. Canvas never nests them (only <section>
// nests in real exports), so such a file is refused too.
const NOT_SELF_NESTED = new Set([
  'item', 'itemmetadata', 'qtimetadatafield', 'fieldlabel', 'response_lid', 'response_label', 'varequal',
]);

// ---- Well-formedness ----------------------------------------------------------
//
// cheerio (htmlparser2) never rejects input: a truncated file silently closes
// every open element. This scan catches truncation and mismatched tags so a
// damaged quiz fails loudly instead of importing half its questions.
//
// It must see the same tags htmlparser2 will, or the depth limit could be
// dodged. So whitespace inside a tag is XML's four characters only (to
// htmlparser2 a no-break space is part of the tag name), and comments,
// declarations and processing instructions end where htmlparser2 ends them.

const XML_NAME = '[A-Za-z_][\\w.:-]*';
const WS = '[ \\t\\r\\n]';
const OPEN_TAG = new RegExp(`<(${XML_NAME})(?:${WS}+${XML_NAME}${WS}*=${WS}*(?:"[^"<]*"|'[^'<]*'))*${WS}*(/?)>`, 'y');
const CLOSE_TAG = new RegExp(`</(${XML_NAME})${WS}*>`, 'y');

function lineAt(xml, index) {
  let line = 1;
  for (let i = xml.indexOf('\n'); i !== -1 && i < index; i = xml.indexOf('\n', i + 1)) line += 1;
  return line;
}

// The name localName() gives the element (prefix dropped, lower case).
function localTagName(name) {
  return name.slice(name.indexOf(':') + 1).toLowerCase();
}

// A short description of the first structural problem, or null.
function xmlStructureProblem(xml) {
  const stack = [];
  const openGuarded = new Map(); // NOT_SELF_NESTED local name -> how many are open
  const at = (index, what) => `line ${lineAt(xml, index)}: ${what}`;
  const skipTo = (from, terminator, what) => {
    const end = xml.indexOf(terminator, from);
    return end === -1 ? { problem: at(from, what) } : { next: end + terminator.length };
  };
  let sawElement = false;
  let i = 0;
  for (;;) {
    const lt = xml.indexOf('<', i);
    if (lt === -1) break;
    let step = null;
    // "<!-->" and "<!--->" are whole comments to htmlparser2.
    if (xml.startsWith('<!--', lt)) step = skipTo(lt + 2, '-->', 'unclosed comment');
    else if (xml.startsWith('<![CDATA[', lt)) step = skipTo(lt + 9, ']]>', 'unclosed CDATA section');
    // htmlparser2 ends a processing instruction at its first ">".
    else if (xml.startsWith('<?', lt)) step = skipTo(lt + 2, '>', 'unclosed processing instruction');
    else if (xml.startsWith('<!', lt)) {
      // Canvas never writes a DTD; an internal subset is where entity-expansion
      // ("billion laughs") payloads live, so refuse it outright.
      // htmlparser2 skips the character after "<!" (and after "<!-") before it
      // looks for the ">", so "<!>" runs on to the next ">".
      const end = xml.indexOf('>', lt + (xml[lt + 2] === '-' ? 4 : 3));
      if (end === -1) return at(lt, 'unclosed declaration');
      if (xml.slice(lt, end).includes('[')) return at(lt, 'DTD declarations are not allowed');
      step = { next: end + 1 };
    }
    if (step) {
      if (step.problem) return step.problem;
      i = step.next;
      continue;
    }
    CLOSE_TAG.lastIndex = lt;
    let match = CLOSE_TAG.exec(xml);
    if (match) {
      const open = stack.pop();
      if (open !== match[1]) {
        return at(lt, open ? `</${match[1]}> does not close <${open}>` : `</${match[1]}> has no opening tag`);
      }
      const local = localTagName(open);
      if (openGuarded.has(local)) openGuarded.set(local, openGuarded.get(local) - 1);
      i = CLOSE_TAG.lastIndex;
      continue;
    }
    OPEN_TAG.lastIndex = lt;
    match = OPEN_TAG.exec(xml);
    if (match) {
      sawElement = true;
      const local = localTagName(match[1]);
      const guarded = NOT_SELF_NESTED.has(local);
      if (guarded && openGuarded.get(local)) return at(lt, `<${match[1]}> is inside another <${local}>`);
      if (!match[2]) {
        stack.push(match[1]);
        if (guarded) openGuarded.set(local, (openGuarded.get(local) || 0) + 1);
      }
      if (stack.length > MAX_XML_DEPTH) return at(lt, `<${match[1]}> is nested more than ${MAX_XML_DEPTH} elements deep`);
      i = OPEN_TAG.lastIndex;
      continue;
    }
    return at(lt, 'a "<" that does not start a valid tag');
  }
  if (stack.length) return `<${stack[stack.length - 1]}> is never closed; the file may be cut short`;
  if (!sawElement) return 'there are no XML elements';
  return null;
}

// True when htmlparser2 might open more than `limit` elements: each one starts
// at a "<" that is not followed by "!", "?", "/", ">" or its whitespace. That
// also bounds how deep it can nest them.
function mayOpenMoreThan(xml, limit) {
  const tagStart = /<[^!?/> \t\n\f\r]/g;
  let count = 0;
  while (tagStart.exec(xml)) {
    count += 1;
    if (count > limit) return true;
  }
  return false;
}

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

// ---- DOM helpers (domhandler nodes from cheerio) ------------------------------
//
// Matching on the local name keeps a prefixed export (<qti:item>) readable.

function localName(node) {
  return node && node.type === 'tag' ? localTagName(node.name) : '';
}

function childElements(node, name) {
  return (node.children || []).filter((c) => c.type === 'tag' && (!name || localName(c) === name));
}

function firstChild(node, name) {
  return childElements(node, name)[0] || null;
}

// Document-order descendant elements named `name`. Elements named `skip` are
// not entered, so nothing inside them is found.
function descendants(node, name, skip = null) {
  const found = [];
  const walk = (parent) => {
    for (const c of parent.children || []) {
      if (c.type !== 'tag') continue;
      const local = localName(c);
      if (local === name) found.push(c);
      if (local !== skip) walk(c);
    }
  };
  walk(node);
  return found;
}

function textOf(node) {
  if (!node) return '';
  if (node.type === 'text') return node.data;
  return (node.children || []).map(textOf).join('');
}

function attr(node, name) {
  const value = node && node.attribs ? node.attribs[name] : undefined;
  return typeof value === 'string' ? value : null;
}

// <mattext> holds escaped HTML as text. A tool that wrote raw child elements
// instead gets them serialised back so their markup (images) is not lost.
function mattextValue($, mattext) {
  if (!mattext) return '';
  if (childElements(mattext).length) return $(mattext).html() || '';
  return textOf(mattext);
}

function normalizeTexttype(value) {
  return String(value || '').trim().toLowerCase() === 'text/html' ? 'text/html' : 'text/plain';
}

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function trimmedOrNull(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text : null;
}

// ---- assessment_meta.xml ----------------------------------------------------

function parseBoolean(value) {
  const text = String(value || '').trim().toLowerCase();
  if (text === 'true') return true;
  if (text === 'false') return false;
  return null;
}

// Read leniently: a quiz can still import with default settings, and the title
// falls back to the assessment's own title attribute.
function parseMeta(metaXml) {
  const result = {
    title: '',
    meta: {
      description: '',
      shuffleAnswers: null,
      cantGoBack: false,
      timeLimitMinutes: null,
      dueAt: null,
      unlockAt: null,
      lockAt: null,
    },
  };
  if (typeof metaXml !== 'string' || !metaXml.trim()) return result;
  const source = stripBom(metaXml);
  // A damaged file is still read, but only when it is too small to nest deeply
  // (Canvas writes about 70 elements); anything bigger must pass the quiz
  // file's structure check, depth limit included, or it is ignored.
  if (mayOpenMoreThan(source, MAX_XML_DEPTH) && xmlStructureProblem(source)) return result;
  const $ = cheerio.load(source, { xml: true });
  const quiz = descendants($.root()[0], 'quiz')[0];
  if (!quiz) return result;
  const field = (name) => {
    const el = firstChild(quiz, name);
    return el ? textOf(el).trim() : null;
  };
  const timeLimit = Number(field('time_limit') || NaN);
  result.title = field('title') || '';
  Object.assign(result.meta, {
    description: field('description') || '',
    shuffleAnswers: parseBoolean(field('shuffle_answers')),
    cantGoBack: parseBoolean(field('cant_go_back')) === true,
    timeLimitMinutes: Number.isFinite(timeLimit) && timeLimit > 0 ? timeLimit : null,
    dueAt: field('due_at') || null,
    unlockAt: field('unlock_at') || null,
    lockAt: field('lock_at') || null,
  });
  return result;
}

// ---- Items ------------------------------------------------------------------

function itemMetadata(item) {
  const fields = new Map();
  for (const field of descendants(firstChild(item, 'itemmetadata') || { children: [] }, 'qtimetadatafield')) {
    const label = textOf(firstChild(field, 'fieldlabel')).trim();
    if (label && !fields.has(label)) fields.set(label, textOf(firstChild(field, 'fieldentry')).trim());
  }
  return fields;
}

// A respcondition that awards score: a <setvar> (any variable) that sets or adds
// a positive number. Feedback-only conditions and <setvar>0</setvar> do not count.
function isScoring(respcondition) {
  return childElements(respcondition, 'setvar').some((setvar) => {
    const action = (attr(setvar, 'action') || 'Set').trim().toLowerCase();
    if (action !== 'set' && action !== 'add') return false;
    const value = Number(textOf(setvar).trim());
    return Number.isFinite(value) && value > 0;
  });
}

// Condition elements named `name` that are not negated by an enclosing <not>.
// The walk does not enter <not>, so each condition is read in one pass.
function positiveTests(respcondition, name) {
  const conditionvar = firstChild(respcondition, 'conditionvar');
  return conditionvar ? descendants(conditionvar, name, 'not') : [];
}

function readChoices($, lid) {
  return descendants(lid, 'response_label').map((label) => {
    const mattext = descendants(label, 'mattext')[0] || null;
    return {
      ident: (attr(label, 'ident') || '').trim(),
      text: mattextValue($, mattext),
      texttype: normalizeTexttype(attr(mattext, 'texttype')),
    };
  });
}

function blankIdOf(lid) {
  const ident = (attr(lid, 'ident') || '').trim();
  if (ident.startsWith('response_') && ident.length > 'response_'.length) return ident.slice('response_'.length);
  const material = firstChild(lid, 'material');
  return textOf(material && descendants(material, 'mattext')[0]).trim() || ident;
}

// Values named by positive <varequal>s of the scoring conditions, in document
// order.
function scoredValues(scoring) {
  const values = [];
  for (const condition of scoring) {
    for (const test of positiveTests(condition, 'varequal')) {
      const value = textOf(test).trim();
      if (value) values.push(value);
    }
  }
  return values;
}

// The same values grouped by the (trimmed) respident they name, in one pass.
// `anyResponse` holds those of varequals with no respident, which count for
// every response.
function scoredValuesByRespident(scoring) {
  const byRespident = new Map();
  const anyResponse = new Set();
  for (const condition of scoring) {
    for (const test of positiveTests(condition, 'varequal')) {
      const value = textOf(test).trim();
      if (!value) continue;
      const target = attr(test, 'respident');
      if (target === null) {
        anyResponse.add(value);
        continue;
      }
      const key = target.trim();
      if (!byRespident.has(key)) byRespident.set(key, new Set());
      byRespident.get(key).add(value);
    }
  }
  return { byRespident, anyResponse };
}

// itemfeedback HTML by ident. Plain-text feedback is escaped so every *Html
// field really is HTML.
function readFeedback($, itemEl) {
  const byId = new Map();
  for (const fb of childElements(itemEl, 'itemfeedback')) {
    const mattext = descendants(fb, 'mattext')[0] || null;
    const value = mattextValue($, mattext);
    if (!value.trim()) continue;
    const html = normalizeTexttype(attr(mattext, 'texttype')) === 'text/html' ? value : escapeHtml(value);
    byId.set((attr(fb, 'ident') || '').trim(), html);
  }
  return byId;
}

// MC, true/false, multiple answers: options, correct options, answer comments.
function readChoiceItem($, item, { lids, conditions, scoring, feedbackById, usedFeedback, warn }) {
  if (lids.length > 1) warn(PARSE_WARNINGS.EXTRA_RESPONSE_AREAS);
  item.choices = readChoices($, lids[0]);
  // Sets throughout: an item can have many thousands of options and conditions.
  const choiceIdents = new Set(item.choices.map((c) => c.ident));
  if (choiceIdents.size !== item.choices.length) warn(PARSE_WARNINGS.DUPLICATE_CHOICE_IDENT);

  const named = new Set(scoredValues(scoring));
  // A Set keeps first-occurrence order: choice order, repeats collapsed.
  item.correctChoiceIdents = [...choiceIdents].filter((id) => named.has(id));
  if ([...named].some((id) => !choiceIdents.has(id))) warn(PARSE_WARNINGS.UNKNOWN_CORRECT_CHOICE);

  // Canvas writes each answer comment as its own continue="Yes" condition
  // (varequal + displayfeedback) ahead of the scoring one.
  const generalIds = Object.values(GENERAL_FEEDBACK_IDENTS);
  const scoringSet = new Set(scoring);
  for (const condition of conditions) {
    if (scoringSet.has(condition)) continue;
    const link = childElements(condition, 'displayfeedback')
      .map((d) => (attr(d, 'linkrefid') || '').trim())
      .find((id) => feedbackById.has(id) && !generalIds.includes(id));
    if (!link) continue;
    for (const test of positiveTests(condition, 'varequal')) {
      const choice = textOf(test).trim();
      if (!choiceIdents.has(choice) || item.choiceFeedbackHtml[choice] !== undefined) continue;
      item.choiceFeedbackHtml[choice] = feedbackById.get(link);
      usedFeedback.add(link);
    }
  }
}

// One blank per response_lid. Fill-in-multiple-blanks accepts every label of a
// blank even though its scoring condition names only the first; a dropdown
// accepts only the option its scoring condition names.
function readBlanks($, questionType, lids, scoring) {
  const scored = questionType === CANVAS_QUESTION_TYPES.MULTIPLE_DROPDOWNS ? scoredValuesByRespident(scoring) : null;
  return lids.map((lid) => {
    let labels = readChoices($, lid);
    if (scored) {
      const own = scored.byRespident.get((attr(lid, 'ident') || '').trim()) || new Set();
      labels = labels.filter((label) => own.has(label.ident) || scored.anyResponse.has(label.ident));
    }
    return { id: blankIdOf(lid), answers: labels.map((label) => label.text.trim()).filter(Boolean) };
  });
}

// One answer per scoring condition, strings exactly as written.
function readNumericAnswers(scoring) {
  const first = (condition, names) => {
    for (const name of names) {
      const value = trimmedOrNull(textOf(positiveTests(condition, name)[0]));
      if (value !== null) return value;
    }
    return null;
  };
  return scoring
    .map((condition) => ({
      exact: first(condition, ['varequal']),
      min: first(condition, ['vargte', 'vargt']),
      max: first(condition, ['varlte', 'varlt']),
    }))
    // A scoring condition with no number in it (e.g. <other/>) is not an answer.
    .filter((answer) => answer.exact !== null || answer.min !== null || answer.max !== null);
}

function parseItem($, itemEl, fallbackIdent) {
  const metadata = itemMetadata(itemEl);
  const points = Number(metadata.get('points_possible') || NaN);
  const presentation = firstChild(itemEl, 'presentation');
  const resprocessing = firstChild(itemEl, 'resprocessing');
  const stemMaterial = presentation ? firstChild(presentation, 'material') : null;
  const stemMattext = stemMaterial ? descendants(stemMaterial, 'mattext')[0] || null : null;
  const questionType = metadata.get('question_type') || null;

  const item = {
    ident: (attr(itemEl, 'ident') || '').trim() || fallbackIdent,
    title: (attr(itemEl, 'title') || '').trim(),
    questionType,
    pointsPossible: Number.isFinite(points) ? points : null,
    stemHtml: mattextValue($, stemMattext),
    stemTexttype: normalizeTexttype(attr(stemMattext, 'texttype')),
    choices: [],
    correctChoiceIdents: [],
    choiceFeedbackHtml: {},
    feedbackHtml: { general: null, correct: null, incorrect: null },
    numericAnswers: [],
    blanks: [],
    shortAnswers: [],
    rawWarnings: [],
  };
  const warn = (message) => {
    if (!item.rawWarnings.includes(message)) item.rawWarnings.push(message);
  };

  const conditions = resprocessing ? childElements(resprocessing, 'respcondition') : [];
  const scoring = conditions.filter(isScoring);
  const lids = presentation ? descendants(presentation, 'response_lid') : [];
  const feedbackById = readFeedback($, itemEl);
  const usedFeedback = new Set();
  for (const [key, id] of Object.entries(GENERAL_FEEDBACK_IDENTS)) {
    if (!feedbackById.has(id)) continue;
    item.feedbackHtml[key] = feedbackById.get(id);
    usedFeedback.add(id);
  }

  if (lids.length && !NON_CHOICE_LID_TYPES.has(questionType)) {
    readChoiceItem($, item, { lids, conditions, scoring, feedbackById, usedFeedback, warn });
  }
  if (BLANK_TYPES.has(questionType)) item.blanks = readBlanks($, questionType, lids, scoring);
  if (questionType === CANVAS_QUESTION_TYPES.NUMERICAL) item.numericAnswers = readNumericAnswers(scoring);
  if (questionType === CANVAS_QUESTION_TYPES.SHORT_ANSWER) item.shortAnswers = scoredValues(scoring);

  // Feedback with nowhere to go (a numerical answer's comment, a blank's) is
  // flagged rather than dropped silently.
  if ([...feedbackById.keys()].some((id) => !usedFeedback.has(id))) warn(PARSE_WARNINGS.FEEDBACK_NOT_READ);
  return item;
}

// ---- Quiz -------------------------------------------------------------------

function badXml(label, detail) {
  return new CanvasImportError(
    `The Canvas quiz "${label}" could not be read: ${detail}. Export the quiz from Canvas again and re-upload it.`,
    'BAD_XML',
  );
}

function tooManyQuestions(cap) {
  return new CanvasImportError(
    `This quiz has more than ${cap} questions or groups, which is too many to import.`,
    'TOO_LARGE',
    413,
  );
}

function parseCanvasQuiz({ ident, xml, metaXml } = {}) {
  const { title: metaTitle, meta } = parseMeta(metaXml);
  const label = metaTitle || ident || 'unknown quiz';
  if (typeof xml !== 'string' || !xml.trim()) throw badXml(label, 'its quiz file is empty');
  const source = stripBom(xml);
  const problem = xmlStructureProblem(source);
  if (problem) throw badXml(label, `its quiz file is not valid XML (${problem})`);

  const $ = cheerio.load(source, { xml: true });
  const assessment = descendants($.root()[0], 'assessment')[0];
  if (!assessment) throw badXml(label, 'its quiz file has no assessment in it');

  const rootSection = firstChild(assessment, 'section') || assessment;
  // Counted before any item is read, so an oversized quiz costs no more work.
  const slotElements = childElements(rootSection).filter((child) => ['item', 'section'].includes(localName(child)));
  if (slotElements.length > MAX_SLOTS_PER_QUIZ) throw tooManyQuestions(MAX_SLOTS_PER_QUIZ);
  // Sections nested deeper than one level are flattened into their group.
  const groupItems = slotElements.map((child) => (localName(child) === 'section' ? descendants(child, 'item') : null));
  const totalItems = groupItems.reduce((sum, items) => sum + (items ? items.length : 1), 0);
  if (totalItems > MAX_ITEMS_PER_QUIZ) throw tooManyQuestions(MAX_ITEMS_PER_QUIZ);

  let itemCount = 0;
  let groupCount = 0;
  const readItem = (el) => {
    itemCount += 1;
    return parseItem($, el, `item-${itemCount}`);
  };

  const slots = [];
  slotElements.forEach((child, index) => {
    const kind = localName(child);
    if (kind === 'item') {
      const item = readItem(child);
      slots.push({ kind: 'item', ident: item.ident, item });
    } else {
      groupCount += 1;
      const selection = descendants(firstChild(child, 'selection_ordering') || { children: [] }, 'selection')[0];
      const pick = Number(textOf(selection && firstChild(selection, 'selection_number')).trim() || NaN);
      const extension = selection && firstChild(selection, 'selection_extension');
      const ppi = trimmedOrNull(textOf(extension && firstChild(extension, 'points_per_item')));
      slots.push({
        kind: 'group',
        ident: (attr(child, 'ident') || '').trim() || `group-${groupCount}`,
        title: (attr(child, 'title') || '').trim(),
        pick: Number.isFinite(pick) && pick >= 1 ? Math.floor(pick) : 1,
        pointsPerItem: ppi !== null && Number.isFinite(Number(ppi)) ? Number(ppi) : null,
        sourceBankRef: trimmedOrNull(textOf(selection && firstChild(selection, 'sourcebank_ref'))),
        items: groupItems[index].map(readItem),
      });
    }
  });

  // New Quizzes exports reuse this format; they mark the assessment with the
  // Canvas assignment id and every item with a calculator_type field.
  const isNewQuizzes =
    attr(assessment, 'external_assignment_id') !== null ||
    descendants(assessment, 'itemmetadata').some((itemmetadata) =>
      descendants(itemmetadata, 'fieldlabel').some((el) => textOf(el).trim() === 'calculator_type'));

  return {
    ident: ident || (attr(assessment, 'ident') || '').trim(),
    title: metaTitle || (attr(assessment, 'title') || '').trim() || 'Untitled quiz',
    flavour: isNewQuizzes ? 'new-quizzes' : 'classic',
    meta,
    slots,
  };
}

module.exports = {
  parseCanvasQuiz,
  CANVAS_QUESTION_TYPES,
  PARSE_WARNINGS,
  MAX_SLOTS_PER_QUIZ,
  MAX_ITEMS_PER_QUIZ,
  MAX_XML_DEPTH,
};
