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
 *     own sampling and evaluator, and writes each answer as GRASP shows it.
 *   - GRASP with no tolerance accepts anything that rounds to the shown answer;
 *     Canvas with a tolerance of 0 accepts only the shown answer itself. The
 *     export writes half a unit of the last shown digit instead, so the same
 *     answers are accepted. GRASP shows very large and very small answers as
 *     a × 10^n, where that half digit is relative to the size of the answer; a
 *     question whose answers are all shown that way gets the equivalent percent
 *     tolerance. One tolerance can't serve both kinds of answer, so when the
 *     value sets mix them, only the larger group is kept.
 *   - Formulas use another dialect (canvas-formula.js). After translating, the
 *     Canvas formula is read back the way the Canvas import reads it and must
 *     give the same number at every value set, or the question is left out.
 *   - Canvas replaces [name] in the question text with a value. GRASP writes
 *     {{name}}, and shows a "Given:" line for a variable the text doesn't
 *     mention; the export writes that line with [name] too.
 *
 * Anything that cannot be represented is a { skip: reason } for the export to
 * report, never a plausible wrong question.
 */

const CalculationQuestion = require('../models/questions/CalculationQuestion');
const {
  canvasFormulaToGrasp,
  graspFormulaToCanvas,
  graspPlaceholdersToCanvas,
  UNSUPPORTED_CANVAS_FUNCTIONS,
} = require('./canvas-formula');

// Value sets per formula question. Canvas's editor generates 10 by default and
// each student gets one; more sets means fewer students share values.
const VALUE_SET_COUNT = 50;
const MAX_DRAWS = VALUE_SET_COUNT * 20;

// Canvas finds variables in question text as [letters and digits]. Names it
// would read as one of its functions or constants are refused as well.
const CANVAS_VARIABLE_NAME = /^[A-Za-z][A-Za-z0-9]*$/;
const CANVAS_FUNCTION_NAMES = new Set([
  ...UNSUPPORTED_CANVAS_FUNCTIONS,
  'abs', 'acos', 'asin', 'atan', 'ceil', 'cos', 'deg_to_rad', 'e', 'fact', 'floor',
  'ln', 'log', 'max', 'min', 'pi', 'rad_to_deg', 'round', 'sin', 'sqrt', 'tan',
]);

// A number as QTI text: 12 significant digits at most, so float noise such as
// 0.30000000000000004 is written 0.3.
function qtiNumber(value) {
  const n = Number(Number(value).toPrecision(12));
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

// Value sets and Canvas tolerance for GRASP's "no tolerance" (rounds to the
// shown answer). Answers shown as plain decimals get half a unit of the last
// decimal; answers shown as a × 10^n get that half digit as a percent, the
// largest any set needs. A mix keeps the larger group.
function exactRule(sets, decimals) {
  const scientific = sets.filter(({ answer }) => CalculationQuestion.usesScientificDisplay(answer, decimals));
  const plain = sets.filter(({ answer }) => !CalculationQuestion.usesScientificDisplay(answer, decimals));
  if (scientific.length <= plain.length) {
    return { sets: plain, tolerance: qtiNumber(0.5 * 10 ** -decimals) };
  }
  const relative = Math.max(...scientific.map(({ answer }) => halfShownUnit(answer, decimals) / Math.abs(answer)));
  return { sets: scientific, tolerance: `${qtiNumber(roundUpTwoDigits(relative * 100))}%` };
}

// An answer as Canvas stores it: the formula's value rounded to the question's
// decimal places.
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

// Up to VALUE_SET_COUNT distinct value sets with their finite answers, drawn
// the way GRASP draws an attempt.
function drawValueSets(formula, specs) {
  const sets = [];
  const seen = new Set();
  for (let draw = 0; draw < MAX_DRAWS && sets.length < VALUE_SET_COUNT; draw += 1) {
    const values = CalculationQuestion.generateVariableValues(specs);
    const key = JSON.stringify(values);
    if (seen.has(key)) continue;
    seen.add(key);
    let answer;
    try {
      answer = CalculationQuestion.evaluateCalculationFormula(formula, values);
    } catch (error) {
      if (CalculationQuestion.isRetryableCalculationDrawError(error)) continue;
      throw error;
    }
    sets.push({ values, answer });
  }
  return sets;
}

function sameNumber(a, b) {
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a));
}

// The value sets Canvas would compute differently from GRASP, once the Canvas
// formula is read back the way the Canvas import reads it. Normally none.
function translationMismatch(canvasFormula, names, sets) {
  const back = canvasFormulaToGrasp(canvasFormula, names);
  if (back.error) return `it can't be read back (${back.error})`;
  for (const { values, answer } of sets) {
    let again;
    try {
      again = CalculationQuestion.evaluateCalculationFormula(back.formula, values);
    } catch {
      again = NaN;
    }
    if (!sameNumber(answer, again)) {
      const at = names.map((name) => `${name} = ${values[name]}`).join(', ');
      return `at ${at} it gives ${again} where GRASP gives ${answer}`;
    }
  }
  return null;
}

function formatVariableValue(value, variable) {
  return variable.scale === 0 ? String(Math.round(value)) : Number(value).toFixed(variable.scale);
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

  let sets;
  try {
    sets = drawValueSets(formula, specs);
  } catch (error) {
    return { skip: `GRASP can't draw values for this question: ${error.message}` };
  }
  if (sets.length === 0) {
    return { skip: `No values in the variables' ranges give the formula a finite answer (tried ${MAX_DRAWS} draws).` };
  }
  const mismatch = translationMismatch(translated.formula, names, sets);
  if (mismatch) return { skip: `The formula written for Canvas (${translated.formula}) doesn't match GRASP's: ${mismatch}.` };

  let rule;
  if (!tolerance) rule = exactRule(sets, decimals);
  else if (tolerance.mode === CalculationQuestion.TOLERANCE_MODES.PERCENT) rule = { sets, tolerance: `${qtiNumber(tolerance.value)}%` };
  else rule = { sets, tolerance: qtiNumber(tolerance.value) };

  // Enough decimal places that no answer loses a digit GRASP shows.
  const decimalPlaces = Math.max(decimals, ...rule.sets.map(({ answer }) => shownPlaces(answer, decimals)));
  const variables = specs.map(canvasVariable);
  return {
    type: 'calculated_question',
    stem: stem.text,
    formula: translated.formula,
    decimalPlaces,
    tolerance: rule.tolerance,
    variables,
    valueSets: rule.sets.map(({ values, answer }) => ({
      values: Object.fromEntries(variables.map((variable) => [variable.name, formatVariableValue(values[variable.name], variable)])),
      answer: qtiNumber(roundedAnswer(answer, decimalPlaces)),
    })),
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
  let margin;
  if (!tolerance) margin = halfShownUnit(value, decimals);
  else if (tolerance.mode === CalculationQuestion.TOLERANCE_MODES.ABSOLUTE) margin = tolerance.value;
  else margin = value === 0 ? 0.5 * 10 ** -decimals : Math.abs(value) * (tolerance.value / 100);
  return {
    type: 'numerical_question',
    stem: template,
    answer: { exact: qtiNumber(shown), min: qtiNumber(shown - margin), max: qtiNumber(shown + margin) },
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
