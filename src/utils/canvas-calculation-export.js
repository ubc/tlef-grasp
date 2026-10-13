/**
 * GRASP calculation questions -> Canvas Classic Quizzes questions (#63).
 *
 * A calculation question with variables becomes a Canvas formula question
 * (calculated_question); one with no variables has a single fixed answer and
 * becomes a numerical question. This module decides the content (text,
 * formula, value sets, tolerance) and why a question cannot be exported; the
 * QTI XML around it is written in src/controllers/question.js.
 *
 * Differences that matter:
 *   - GRASP draws fresh values for every attempt. Canvas serves one of a fixed
 *     list of value sets stored with the question and never evaluates the
 *     formula for a student, so the export draws that list here, with GRASP's
 *     own sampling and evaluator. Each answer is worked out from the values as
 *     Canvas shows them (at the variable's decimals) and stored rounded to the
 *     decimal places, as Canvas stores its own.
 *   - GRASP with no tolerance accepts anything that rounds to the shown answer;
 *     Canvas with a tolerance of 0 accepts only the stored answer itself. The
 *     export writes half a unit of the last shown digit instead, so the same
 *     answers are accepted. GRASP shows very large and very small answers as
 *     a × 10^n, where that half digit depends on the power of ten. When every
 *     answer has the same power it is one margin, exact for small answers and
 *     at most a unit for answers of 10^9 and up (Canvas stores those to the
 *     decimal places, so more digits than GRASP shows). When the powers differ,
 *     it becomes a percent, the largest any answer needs, so Canvas accepts
 *     everything GRASP does, and up to about ten times more for an answer with
 *     a larger mantissa. One tolerance can't serve both plain and a × 10^n
 *     answers, so when the value sets mix them, only the larger group is kept.
 *   - A percent or absolute tolerance keeps GRASP's meaning. Canvas measures
 *     either from the stored answer; GRASP measures a percent from the exact
 *     value, so for a percent the answer is stored with four more places, and
 *     an absolute margin from the exact or the shown answer, whichever is
 *     closer, so the margin grows by the rounding gap (under half a shown
 *     digit, 0.05 -> 0.055 at 2 decimals).
 *   - Formulas use another dialect (canvas-formula.js). After translating, the
 *     Canvas formula is worked out the way Canvas's own calculator does it and
 *     must give GRASP's number at every value set, or the question is left out.
 *   - Canvas replaces [name] in the question text with a value. GRASP writes
 *     {{name}}, and shows a "Given:" line for a variable the text doesn't
 *     mention; the export writes that line with [name] too.
 *
 * Anything that cannot be represented is a { skip: reason } for the export to
 * report, never a plausible wrong question.
 */

const CalculationQuestion = require('../models/questions/CalculationQuestion');
const {
  graspFormulaToCanvas,
  evaluateCanvasFormula,
  FormulaError,
  graspPlaceholdersToCanvas,
  UNSUPPORTED_CANVAS_FUNCTIONS,
} = require('./canvas-formula');

// Value sets per formula question. Canvas's editor generates 10 by default and
// each student gets one; more sets means fewer students share values.
const VALUE_SET_COUNT = 50;
const MAX_DRAWS = VALUE_SET_COUNT * 20;

// Canvas's quiz editor finds variables in question text as [letters and
// digits] and drops any other variable when the question is opened, so "_" is
// refused even though Canvas's grading would accept it. Names it would read as
// one of its functions or constants are refused as well.
const CANVAS_VARIABLE_NAME = /^[A-Za-z][A-Za-z0-9]*$/;
const CANVAS_FUNCTION_NAMES = new Set([
  ...UNSUPPORTED_CANVAS_FUNCTIONS,
  'abs', 'acos', 'asin', 'atan', 'ceil', 'cos', 'deg_to_rad', 'e', 'fact', 'floor',
  'ln', 'log', 'max', 'min', 'pi', 'rad_to_deg', 'round', 'sin', 'sqrt', 'tan',
]);

// A number as QTI text: 15 significant digits at most, so float noise such as
// 0.30000000000000004 is written 0.3.
function qtiNumber(value) {
  const n = Number(Number(value).toPrecision(15));
  return Object.is(n, -0) ? '0' : String(n);
}

// Decimal places of an answer as the student sees it: the question's decimals,
// or for an answer shown as a × 10^n, enough places to keep the shown digits.
function shownPlaces(value, decimals) {
  if (!CalculationQuestion.usesScientificDisplay(value, decimals)) return decimals;
  return decimals - CalculationQuestion.decimalExponentOf(value);
}

// Half a unit of the last shown digit: the margin that makes "anything that
// rounds to the shown answer" a tolerance.
function halfShownUnit(value, decimals) {
  return 0.5 * 10 ** -shownPlaces(value, decimals);
}

// x rounded up to two significant digits (0.4772 -> 0.48), for a tolerance
// that must not be smaller than x.
function roundUpTwoDigits(x) {
  const unit = 10 ** (Math.floor(Math.log10(x)) - 1);
  return Math.ceil(x / unit - 1e-9) * unit;
}

// The value sets a Canvas tolerance can serve, for GRASP's no tolerance
// ("rounds to the shown answer"): plain answers and answers shown as a × 10^n
// need different margins, so a mix keeps the larger group.
function exactRuleSets(sets, decimals) {
  const scientific = sets.filter(({ answer }) => CalculationQuestion.usesScientificDisplay(answer, decimals));
  const plain = sets.filter(({ answer }) => !CalculationQuestion.usesScientificDisplay(answer, decimals));
  return scientific.length <= plain.length ? plain : scientific;
}

// Canvas's tolerance for GRASP's no tolerance, given each set's stored answer:
// wide enough that Canvas accepts everything GRASP does (half the last shown
// digit around the shown answer), from the stored answer. One margin when the
// answers share a power of ten, else the percent the widest set needs.
function exactRuleTolerance(sets, decimals) {
  const reach = sets.map(({ answer, shown, stored }) => ({
    margin: halfShownUnit(answer, decimals) + Math.abs(stored - shown),
    stored,
  }));
  const powers = new Set(sets.map(({ answer }) => CalculationQuestion.decimalExponentOf(answer)));
  const scientific = CalculationQuestion.usesScientificDisplay(sets[0].answer, decimals);
  if (!scientific || powers.size === 1) return qtiNumber(roundUpTwoDigits(Math.max(...reach.map(({ margin }) => margin))));
  const relative = Math.max(...reach.map(({ margin, stored }) => margin / Math.abs(stored)));
  return `${qtiNumber(roundUpTwoDigits(relative * 100))}%`;
}

// x rounded up at the given decimal places, for a margin that must not shrink.
function roundUpAt(x, places) {
  const scale = 10 ** places;
  return Math.ceil(x * scale - 1e-9) / scale;
}

// An absolute margin as Canvas needs it: GRASP's margin counts from the exact
// or the shown answer, Canvas's from the stored one, so it grows by the
// largest gap from the stored answer to either.
function absoluteMargin(margin, gaps, places) {
  return qtiNumber(roundUpAt(margin + Math.max(0, ...gaps), places + 1));
}

// GRASP's percent of an answer of exactly 0 accepts anything that rounds to 0;
// Canvas's percent of 0 accepts only 0. Those value sets are left out, unless
// every set's answer is 0, which is then half a unit either side.
function percentRule(sets, percent, decimals) {
  const nonZero = sets.filter(({ answer }) => answer !== 0);
  if (nonZero.length > 0) return { sets: nonZero, tolerance: () => `${qtiNumber(percent)}%` };
  return { sets, tolerance: () => qtiNumber(0.5 * 10 ** -decimals) };
}

// An answer as Canvas stores it: the formula's value rounded to the decimal
// places.
function roundedAnswer(value, places) {
  if (places <= 12) return CalculationQuestion.roundToDecimals(value, places);
  return Number(value.toFixed(Math.min(places, 100)));
}

function variableSpecsOf(question) {
  const specs = Array.isArray(question.calculationVariables) ? question.calculationVariables : [];
  return specs.filter((spec) => CalculationQuestion.sanitizeVariableName(spec));
}

// A variable's range as Canvas reads it. Whole-number variables are written
// with the whole numbers GRASP actually draws from (1.5 to 9.5 -> 2 to 9).
function canvasVariable(spec) {
  const name = CalculationQuestion.sanitizeVariableName(spec);
  if (spec.integerOnly === true) {
    return { name, scale: 0, min: String(Math.ceil(Number(spec.min))), max: String(Math.floor(Number(spec.max))) };
  }
  const scale = Math.max(0, Math.min(8, parseInt(spec.decimals, 10) || 0));
  return { name, scale, min: qtiNumber(spec.min), max: qtiNumber(spec.max) };
}

function nameProblem(name) {
  if (!CANVAS_VARIABLE_NAME.test(name)) {
    return `The variable name "${name}" isn't one Canvas can use: Canvas variable names are letters and digits, starting with a letter.`;
  }
  if (CANVAS_FUNCTION_NAMES.has(name)) {
    return `The variable name "${name}" is also the name of a Canvas formula function or constant.`;
  }
  return null;
}

// The question text with [name] placeholders and the "Given:" line GRASP adds
// for a variable the text doesn't mention.
function canvasStem(template, specs, names) {
  for (const name of names) {
    if (template.includes(`[${name}]`)) {
      return { skip: `The question text has "[${name}]" written out, which Canvas would replace with a value of the variable ${name}.` };
    }
  }
  const referenced = CalculationQuestion.getStemReferencedVariableNames(template, specs);
  const unmentioned = names.filter((name) => !referenced.has(name));
  let text = graspPlaceholdersToCanvas(template, names);
  if (unmentioned.length > 0) {
    const given = `Given: ${unmentioned.map((name) => `${name} = [${name}]`).join(', ')}.`;
    text = text.trim() ? `${text}\n\n${given}` : given;
  }
  return { text };
}

function formatVariableValue(value, variable) {
  return variable.scale === 0 ? String(Math.round(value)) : Number(value).toFixed(variable.scale);
}

// Up to VALUE_SET_COUNT distinct value sets with their finite answers, drawn
// the way GRASP draws an attempt. Each value is the one Canvas shows (the draw
// at its variable's decimals); a draw GRASP held at a bound with more decimals
// than that can show outside the range, and is drawn again.
function drawValueSets(evaluate, specs, variables, decimals) {
  const sets = [];
  const seen = new Set();
  for (let draw = 0; draw < MAX_DRAWS && sets.length < VALUE_SET_COUNT; draw += 1) {
    const drawn = CalculationQuestion.generateVariableValues(specs);
    const shownValues = Object.fromEntries(variables.map((variable) => [variable.name, formatVariableValue(drawn[variable.name], variable)]));
    const key = JSON.stringify(shownValues);
    if (seen.has(key)) continue;
    seen.add(key);
    const numbers = Object.fromEntries(Object.entries(shownValues).map(([name, value]) => [name, Number(value)]));
    if (variables.some(({ name, min, max }) => numbers[name] < Number(min) || numbers[name] > Number(max))) continue;
    let answer;
    try {
      answer = evaluate(numbers);
    } catch (error) {
      if (CalculationQuestion.isRetryableCalculationDrawError(error)) continue;
      throw error;
    }
    sets.push({ values: shownValues, numbers, answer, shown: CalculationQuestion.roundAsDisplayed(answer, decimals) });
  }
  return sets;
}

function sameNumber(a, b) {
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a));
}

// The first value set where Canvas's calculator works the Canvas formula out
// differently from GRASP, or can't work it out at all. Normally none.
function translationMismatch(canvasFormula, names, sets) {
  for (const { values, numbers, answer } of sets) {
    const at = names.map((name) => `${name} = ${values[name]}`).join(', ');
    let canvas;
    try {
      canvas = evaluateCanvasFormula(canvasFormula, numbers);
    } catch (error) {
      if (error instanceof FormulaError) return `Canvas's calculator can't work it out (${error.message})`;
      throw error;
    }
    if (!sameNumber(answer, canvas)) return `at ${at} Canvas's calculator gives ${canvas} where GRASP gives ${answer}`;
  }
  return null;
}

function toCanvasFormulaQuestion({ formula, specs, template, decimals, tolerance }) {
  const names = specs.map((spec) => CalculationQuestion.sanitizeVariableName(spec));
  for (const name of names) {
    const problem = nameProblem(name);
    if (problem) return { skip: problem };
  }
  if (tolerance && tolerance.mode === CalculationQuestion.TOLERANCE_MODES.RANGE) {
    return { skip: 'A range tolerance needs a fixed answer, and this question has variables.' };
  }
  const translated = graspFormulaToCanvas(formula, names);
  if (translated.error) {
    // The translator's reasons are either "uses ..." or a sentence of their own.
    const reason = translated.error.startsWith('uses ') ? `The formula ${translated.error}.` : `The formula can't be written for Canvas: ${translated.error}.`;
    return { skip: reason };
  }
  const stem = canvasStem(template, specs, names);
  if (stem.skip) return stem;

  const variables = specs.map(canvasVariable);
  let sets;
  try {
    // Parsed once for every draw.
    const evaluate = CalculationQuestion.compileCalculationFormula(formula, names);
    sets = drawValueSets(evaluate, specs, variables, decimals);
  } catch (error) {
    return { skip: `GRASP can't draw values for this question: ${error.message}` };
  }
  if (sets.length === 0) {
    return { skip: `No values in the variables' ranges give the formula a finite answer (tried ${MAX_DRAWS} draws).` };
  }
  const mismatch = translationMismatch(translated.formula, names, sets);
  if (mismatch) return { skip: `The formula written for Canvas (${translated.formula}) doesn't match GRASP's: ${mismatch}.` };

  const percent = tolerance && tolerance.mode === CalculationQuestion.TOLERANCE_MODES.PERCENT;
  let rule;
  if (!tolerance) rule = { sets: exactRuleSets(sets, decimals), tolerance: (stored) => exactRuleTolerance(stored, decimals) };
  else if (percent) rule = percentRule(sets, tolerance.value, decimals);
  else {
    const gaps = (stored) => stored.map(({ answer, shown, stored: s }) => Math.max(Math.abs(answer - s), Math.abs(shown - s)));
    rule = { sets, tolerance: (stored) => absoluteMargin(tolerance.value, gaps(stored), decimalPlaces) };
  }

  // Enough decimal places that no answer loses a digit GRASP shows. Canvas
  // measures a percent from the stored answer and GRASP from the exact one, so
  // for a percent the answer is stored with four more places.
  const decimalPlaces = Math.max(decimals, ...rule.sets.map(({ answer }) => shownPlaces(answer, decimals)));
  const storedPlaces = percent ? decimalPlaces + 4 : decimalPlaces;
  const stored = rule.sets.map((set) => ({ ...set, stored: roundedAnswer(set.answer, storedPlaces) }));
  return {
    type: 'calculated_question',
    stem: stem.text,
    formula: translated.formula,
    decimalPlaces,
    tolerance: rule.tolerance(stored),
    variables,
    valueSets: stored.map((set) => ({ values: set.values, answer: qtiNumber(set.stored) })),
  };
}

function toCanvasNumericalQuestion({ formula, template, decimals, tolerance }) {
  let value;
  try {
    value = CalculationQuestion.evaluateCalculationFormula(formula, {});
  } catch (error) {
    return { skip: `The answer isn't a number GRASP can work out: ${error.message}` };
  }
  if (tolerance && tolerance.mode === CalculationQuestion.TOLERANCE_MODES.RANGE) {
    return { type: 'numerical_question', stem: template, answer: { min: qtiNumber(tolerance.min), max: qtiNumber(tolerance.max) } };
  }
  const shown = CalculationQuestion.roundAsDisplayed(value, decimals);
  const places = shownPlaces(value, decimals);
  // As for formula questions: a percent from the exact value (stored with four
  // more places), an absolute margin grown by the rounding gap.
  let exact = shown;
  let margin;
  if (!tolerance) margin = halfShownUnit(value, decimals);
  else if (tolerance.mode === CalculationQuestion.TOLERANCE_MODES.ABSOLUTE) margin = Number(absoluteMargin(tolerance.value, [Math.abs(value - shown)], places));
  else if (value === 0) margin = 0.5 * 10 ** -decimals;
  else {
    exact = roundedAnswer(value, places + 4);
    margin = roundUpAt(Math.abs(value) * (tolerance.value / 100), places + 4);
  }
  return {
    type: 'numerical_question',
    stem: template,
    answer: { exact: qtiNumber(exact), min: qtiNumber(exact - margin), max: qtiNumber(exact + margin) },
  };
}

/**
 * A stored GRASP calculation question as the content of a Canvas question.
 *
 * @returns {{ type: 'calculated_question', stem, formula, decimalPlaces, tolerance, variables, valueSets }
 *   | { type: 'numerical_question', stem, answer: { exact?, min, max } }
 *   | { skip: string }}  stem is plain text; numbers are strings ready for the XML
 */
function toCanvasCalculation(question) {
  const specs = variableSpecsOf(question);
  const formula = CalculationQuestion.prepareCalculationFormula(question.calculationFormula, specs);
  if (!formula) return { skip: 'The question has no formula.' };
  const { answerDec: decimals, tolerance } = CalculationQuestion.readGradingSettings(question);
  const template = CalculationQuestion.resolveCalculationDisplayTemplate(question.stem, question.title, specs);
  const definition = { formula, specs, template, decimals, tolerance };
  return specs.length === 0 ? toCanvasNumericalQuestion(definition) : toCanvasFormulaQuestion(definition);
}

module.exports = {
  toCanvasCalculation,
  VALUE_SET_COUNT,
};
