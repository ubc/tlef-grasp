/**
 * GRASP calculation questions -> Canvas formula / numerical questions (#63).
 *
 * The value sets are drawn at random, so most checks hold for every set rather
 * than for fixed numbers. "Canvas accepts" below is Canvas's rule for a formula
 * or numerical answer: within the tolerance of the stored answer, a percent
 * tolerance being a percent of that answer.
 */

const { toCanvasCalculation, VALUE_SET_COUNT } = require('../../src/utils/canvas-calculation-export');
const CalculationQuestion = require('../../src/models/questions/CalculationQuestion');
const { evaluateCanvasFormula } = require('../../src/utils/canvas-formula');

const calc = (overrides = {}) => ({
  questionType: 'calculation',
  title: 'Synthetic calculation',
  stem: 'A synthetic sample of {{m}} g in {{v}} L. What is its concentration?',
  calculationFormula: 'm / v',
  calculationVariables: [
    { name: 'm', min: 1, max: 10, integerOnly: true },
    { name: 'v', min: 0.5, max: 2.5, decimals: 1 },
  ],
  calculationAnswerDecimals: 2,
  ...overrides,
});

function canvasAccepts(student, key, tolerance) {
  const answer = Number(key);
  const margin = tolerance.endsWith('%')
    ? Math.abs(answer) * (Number(tolerance.slice(0, -1)) / 100)
    : Number(tolerance);
  return Math.abs(student - answer) <= margin + 1e-12 * Math.max(1, Math.abs(answer));
}

// The exported formula worked out at one value set the way Canvas's own
// calculator works it out (canvas-formula.js follows calcCmd.js).
function canvasValue(result, set) {
  const values = Object.fromEntries(Object.entries(set.values).map(([name, value]) => [name, Number(value)]));
  return evaluateCanvasFormula(result.formula, values);
}

const graspAccepts = (student, exact, decimals = 2) => CalculationQuestion.numericAnswersMatch(student, exact, decimals, null);

describe('formula questions (with variables)', () => {
  test('maps the text, variables, formula, decimals and value sets', () => {
    const result = toCanvasCalculation(calc());

    expect(result).toMatchObject({
      type: 'calculated_question',
      stem: 'A synthetic sample of [m] g in [v] L. What is its concentration?',
      formula: 'm/v',
      decimalPlaces: 2,
      tolerance: '0.005',
      variables: [
        { name: 'm', scale: 0, min: '1', max: '10' },
        { name: 'v', scale: 1, min: '0.5', max: '2.5' },
      ],
    });
    expect(result.valueSets).toHaveLength(VALUE_SET_COUNT);
    const keys = result.valueSets.map((set) => JSON.stringify(set.values));
    expect(new Set(keys).size).toBe(keys.length);
    for (const set of result.valueSets) {
      expect(set.values.m).toMatch(/^([1-9]|10)$/);
      expect(set.values.v).toMatch(/^[0-2]\.\d$/);
      const exact = Number(set.values.m) / Number(set.values.v);
      // Stored as Canvas stores answers: rounded to the decimal places.
      expect(Number(set.answer)).toBe(CalculationQuestion.roundToDecimals(exact, 2));
      expect(canvasValue(result, set)).toBeCloseTo(exact, 12);
    }
  });

  test('a small range keeps every distinct value set once', () => {
    const result = toCanvasCalculation(calc({
      stem: '{{a}} plus {{b}}?',
      calculationFormula: 'a + b',
      calculationVariables: [
        { name: 'a', min: 1, max: 3, integerOnly: true },
        { name: 'b', min: 1, max: 2, integerOnly: true },
      ],
    }));
    expect(result.valueSets.map((set) => `${set.values.a}+${set.values.b}=${set.answer}`).sort())
      .toEqual(['1+1=2', '1+2=3', '2+1=3', '2+2=4', '3+1=4', '3+2=5']);
  });

  test('whole-number variables are written with the whole numbers GRASP draws from', () => {
    const result = toCanvasCalculation(calc({
      stem: 'Twice {{n}}?',
      calculationFormula: '2*n',
      calculationVariables: [{ name: 'n', min: 1.5, max: 9.5, integerOnly: true }],
    }));
    expect(result.variables).toEqual([{ name: 'n', scale: 0, min: '2', max: '9' }]);
  });

  test('decimal variables keep their decimals in every value set (2.0, not 2)', () => {
    const result = toCanvasCalculation(calc({
      stem: 'Half of {{x}}?',
      calculationFormula: 'x / 2',
      calculationVariables: [{ name: 'x', min: 2, max: 2, decimals: 2 }],
    }));
    expect(result.valueSets).toEqual([{ values: { x: '2.00' }, answer: '1' }]);
  });

  test("GRASP's dialect is translated: natural log, log10, E, PI, fac, exp, pow and e-notation", () => {
    const result = toCanvasCalculation(calc({
      stem: 'With {{x}} and {{y}}?',
      calculationFormula: 'log(x) + log10(y) + E + PI + fac(3) + exp(1) + pow(x, 2) + 6.022e-3*y',
      calculationVariables: [
        { name: 'x', min: 1, max: 5, integerOnly: true },
        { name: 'y', min: 1, max: 100, integerOnly: true },
      ],
      calculationAnswerDecimals: 4,
    }));
    expect(result.formula).toBe('ln(x)+log(y)+e+pi+fact(3)+(e^(1))+((x)^(2))+(6.022*10^(-3))*y');
    for (const set of result.valueSets) {
      const x = Number(set.values.x);
      const y = Number(set.values.y);
      const exact = Math.log(x) + Math.log10(y) + Math.E + Math.PI + 6 + Math.E + x * x + 0.006022 * y;
      expect(canvasValue(result, set)).toBeCloseTo(exact, 9);
      expect(Number(set.answer)).toBeCloseTo(exact, 4);
    }
  });

  test('a variable the text does not mention gets a "Given:" line, as GRASP shows it', () => {
    const result = toCanvasCalculation(calc({ stem: 'What is the concentration of a {{m}} g sample?' }));
    expect(result.stem).toBe('What is the concentration of a [m] g sample?\n\nGiven: v = [v].');
  });

  test('the formula-question template is the one students see: single-brace placeholders count', () => {
    const result = toCanvasCalculation(calc({ stem: 'A {m} g sample in {{ v }} L?' }));
    expect(result.stem).toBe('A [m] g sample in [v] L?');
  });

  test('a percent is kept as written, with each answer stored to four more places, as GRASP measures it from the exact value', () => {
    const result = toCanvasCalculation(calc({ calculationTolerance: { mode: 'percent', value: 2 } }));
    expect(result.tolerance).toBe('2%');
    expect(result.decimalPlaces).toBe(2);
    for (const set of result.valueSets) {
      const exact = Number(set.values.m) / Number(set.values.v);
      expect(Math.abs(Number(set.answer) - exact)).toBeLessThanOrEqual(0.5e-6);
      for (const student of [exact * 0.9801, exact * 1.0199]) {
        expect(CalculationQuestion.numericAnswersMatch(student, exact, 2, { mode: 'percent', value: 2 })).toBe(true);
        expect(canvasAccepts(student, set.answer, result.tolerance)).toBe(true);
      }
    }
    expect(toCanvasCalculation(calc({ calculationAnswerTolerancePercent: 1.5 })).tolerance).toBe('1.5%');
  });

  test('an absolute margin grows by the rounding gap, as GRASP measures it from the exact or the shown answer', () => {
    const tolerance = { mode: 'absolute', value: 0.05 };
    const result = toCanvasCalculation(calc({ calculationTolerance: tolerance }));
    expect(Number(result.tolerance)).toBeGreaterThan(0.05);
    expect(Number(result.tolerance)).toBeLessThanOrEqual(0.055);
    for (const set of result.valueSets) {
      const exact = Number(set.values.m) / Number(set.values.v);
      const shown = CalculationQuestion.roundToDecimals(exact, 2);
      for (const student of [exact - 0.0499, exact + 0.0499, shown - 0.0499, shown + 0.0499]) {
        expect(CalculationQuestion.numericAnswersMatch(student, exact, 2, tolerance)).toBe(true);
        expect(canvasAccepts(student, set.answer, result.tolerance)).toBe(true);
      }
    }
    // Answers with nothing to round keep the margin as written.
    const whole = toCanvasCalculation(calc({
      stem: '{{a}} plus {{b}}?',
      calculationFormula: 'a + b',
      calculationVariables: [{ name: 'a', min: 1, max: 9, integerOnly: true }, { name: 'b', min: 1, max: 9, integerOnly: true }],
      calculationTolerance: tolerance,
    }));
    expect(whole.tolerance).toBe('0.05');
  });

  test('no tolerance: Canvas accepts the answer GRASP shows, and anything that rounds to it, at every value set', () => {
    const result = toCanvasCalculation(calc({ calculationAnswerDecimals: 3 }));
    expect(result.tolerance).toBe('0.0005');
    for (const set of result.valueSets) {
      const exact = Number(set.values.m) / Number(set.values.v);
      const shown = Number(CalculationQuestion.formatAnswerForDisplay(exact, 3));
      expect(canvasAccepts(shown, set.answer, result.tolerance)).toBe(true);
      expect(canvasAccepts(exact, set.answer, result.tolerance)).toBe(true);
      // One shown digit off is wrong in both.
      expect(canvasAccepts(shown + 0.001, set.answer, result.tolerance)).toBe(false);
      expect(CalculationQuestion.numericAnswersMatch(shown + 0.001, exact, 3, null)).toBe(false);
    }
  });

  test('no tolerance, answers shown as a × 10^n with one power of ten: half the last shown digit, exactly', () => {
    const result = toCanvasCalculation(calc({
      stem: 'A synthetic rate of {{x}} units?',
      calculationFormula: 'x * 1e-5',
      calculationVariables: [{ name: 'x', min: 1, max: 9.9, decimals: 1 }],
    }));
    expect(result.tolerance).toBe('5e-8');
    for (const set of result.valueSets) {
      const exact = Number(set.values.x) * 1e-5;
      const shown = CalculationQuestion.roundAsDisplayed(exact, 2);
      const unit = 1e-7; // the last shown digit of a.bc × 10^-5
      for (const student of [shown, exact, shown - 0.49 * unit, shown + 0.49 * unit]) {
        expect(graspAccepts(student, exact)).toBe(true);
        expect(canvasAccepts(student, set.answer, result.tolerance)).toBe(true);
      }
      // One shown digit off is wrong in both.
      for (const student of [shown - unit, shown + unit]) {
        expect(graspAccepts(student, exact)).toBe(false);
        expect(canvasAccepts(student, set.answer, result.tolerance)).toBe(false);
      }
    }
  });

  // GRASP's margin is half the last shown digit, whose size follows the power
  // of ten; Canvas has one tolerance per question, so it is the percent the
  // widest set needs: never stricter than GRASP, a few digits more lenient.
  const acceptsWhatGraspAccepts = (result, exactOf) => {
    for (const set of result.valueSets) {
      const exact = exactOf(set);
      const shown = CalculationQuestion.roundAsDisplayed(exact, 2);
      const unit = 10 ** (CalculationQuestion.decimalExponentOf(exact) - 2);
      for (const student of [shown, exact, shown - 0.49 * unit, shown + 0.49 * unit]) {
        expect(graspAccepts(student, exact)).toBe(true);
        expect(canvasAccepts(student, set.answer, result.tolerance)).toBe(true);
      }
      expect(canvasAccepts(shown + 12 * unit, set.answer, result.tolerance)).toBe(false);
      expect(canvasAccepts(shown - 12 * unit, set.answer, result.tolerance)).toBe(false);
      // Stored as Canvas stores answers: rounded to the decimal places.
      expect(Math.abs(Number(set.answer) - exact)).toBeLessThanOrEqual(Math.max(0.5 * 10 ** -result.decimalPlaces, 1e-12 * exact));
    }
  };

  test('no tolerance, a × 10^n answers with different powers of ten: a percent that accepts everything GRASP does', () => {
    const result = toCanvasCalculation(calc({
      stem: '[H+] when the pH is {{p}}?',
      calculationFormula: '10^(-p)',
      calculationVariables: [{ name: 'p', min: 2.1, max: 6, decimals: 1 }],
    }));
    expect(result.tolerance).toMatch(/%$/);
    expect(parseFloat(result.tolerance)).toBeLessThanOrEqual(1);
    expect(result.decimalPlaces).toBe(8);
    acceptsWhatGraspAccepts(result, (set) => 10 ** -Number(set.values.p));
  });

  test('very large answers: the same percent rule, or one margin when they share a power of ten', () => {
    const particles = (max) => toCanvasCalculation(calc({
      stem: 'Particles in {{n}} mol?',
      calculationFormula: '6.022e23 * n',
      calculationVariables: [{ name: 'n', min: 1, max, decimals: 1 }],
    }));
    const exactOf = (set) => 6.022e23 * Number(set.values.n);

    const spread = particles(5);
    expect(spread.formula).toBe('(6.022*10^(23))*n');
    expect(spread.tolerance).toMatch(/%$/);
    acceptsWhatGraspAccepts(spread, exactOf);

    // 1 to 1.6 mol are all a.bc × 10^23. Canvas keeps the answer to the decimal
    // places, so more digits than GRASP shows: the margin also covers that gap.
    const narrow = particles(1.6);
    expect(Number(narrow.tolerance)).toBeGreaterThanOrEqual(0.5e21);
    expect(Number(narrow.tolerance)).toBeLessThanOrEqual(1e21);
    acceptsWhatGraspAccepts(narrow, exactOf);
  });

  test('when plain and a × 10^n answers mix, only the larger group of value sets is kept', () => {
    // x^3 for x from 0.01 to 3: below about 0.215 the answer is under 0.01 and shown as a × 10^n.
    const result = toCanvasCalculation(calc({
      stem: 'Cube {{x}}?',
      calculationFormula: 'x^3',
      calculationVariables: [{ name: 'x', min: 0.01, max: 3, decimals: 2 }],
    }));
    expect(result.tolerance).toBe('0.005');
    expect(result.valueSets.length).toBeGreaterThan(30);
    for (const set of result.valueSets) expect(Number(set.values.x) ** 3).toBeGreaterThanOrEqual(0.01);
  });

  test("Canvas's calculator works the exported formula out as GRASP does: a minus and ^ chains are written for it", () => {
    // Canvas negates only the number or name right after "-" (so -h^2 would be
    // (-h)^2 and -log(h) an error), and works ^ left to right.
    const cases = [
      ['-log10(h)', '-1*log(h)'],
      ['E^(-h^2/2)', 'e^(-1*h^2/2)'],
      ['-(h+1)', '-1*(h+1)'],
      ['2^h^2', '2^(h^2)'],
      ['-h^2', '-1*h^2'],
      ['10^-h', '10^-h'],
    ];
    for (const [formula, canvas] of cases) {
      const result = toCanvasCalculation(calc({
        stem: 'With {{h}}?',
        calculationFormula: formula,
        calculationVariables: [{ name: 'h', min: 0.01, max: 0.9, decimals: 2 }],
      }));
      expect(result.formula).toBe(canvas);
      for (const set of result.valueSets) {
        expect(canvasValue(result, set)).toBeCloseTo(CalculationQuestion.evaluateCalculationFormula(formula, { h: Number(set.values.h) }), 9);
      }
    }
  });

  test('each answer is worked out from the values Canvas shows', () => {
    // GRASP holds a draw below 1.21 at 1.21, which shows as 1.2 at one decimal:
    // outside the range, so it is not a value set; 2.42 would have been wrong.
    const result = toCanvasCalculation(calc({
      stem: 'Twice {{x}}?',
      calculationFormula: '2*x',
      calculationVariables: [{ name: 'x', min: 1.21, max: 1.3, decimals: 1 }],
    }));
    expect(result.valueSets).toEqual([{ values: { x: '1.3' }, answer: '2.6' }]);
  });

  test('a percent tolerance leaves out value sets whose answer is 0, which Canvas could only match exactly', () => {
    const difference = (formula) => toCanvasCalculation(calc({
      stem: '{{a}} minus {{b}}?',
      calculationFormula: formula,
      calculationVariables: [
        { name: 'a', min: 1, max: 3, integerOnly: true },
        { name: 'b', min: 1, max: 3, integerOnly: true },
      ],
      calculationTolerance: { mode: 'percent', value: 5 },
    }));
    const result = difference('a - b');
    expect(result.tolerance).toBe('5%');
    expect(result.valueSets).toHaveLength(6);
    for (const set of result.valueSets) expect(Number(set.answer)).not.toBe(0);
    // When every answer is 0, GRASP's rule for 0 is half a unit either side.
    const zero = difference('a - a + 0*b');
    expect(zero.tolerance).toBe('0.005');
    expect(zero.valueSets).toHaveLength(9);
  });

  test('value sets whose answer is not finite are left out of the list', () => {
    const result = toCanvasCalculation(calc({
      stem: 'One over {{x}}?',
      calculationFormula: '1 / x',
      calculationVariables: [{ name: 'x', min: -1, max: 1, integerOnly: true }],
    }));
    expect(result.valueSets.map((set) => set.values.x).sort()).toEqual(['-1', '1']);
  });
});

describe('fixed-answer questions (no variables) become numerical questions', () => {
  const fixed = (overrides) => calc({ stem: 'A synthetic constant?', calculationVariables: [], ...overrides });

  test('no tolerance: the shown answer with half a unit of its last digit either side', () => {
    expect(toCanvasCalculation(fixed({ calculationFormula: '1/3' }))).toEqual({
      type: 'numerical_question',
      stem: 'A synthetic constant?',
      answer: { exact: '0.33', min: '0.325', max: '0.335' },
    });
    expect(toCanvasCalculation(fixed({ calculationFormula: '6.022e23' })).answer)
      .toEqual({ exact: '6.02e+23', min: '6.015e+23', max: '6.025e+23' });
  });

  test('absolute and percent tolerances become the margin; a range becomes the bounds', () => {
    expect(toCanvasCalculation(fixed({ calculationFormula: '9.81', calculationTolerance: { mode: 'absolute', value: 0.1 } })).answer)
      .toEqual({ exact: '9.81', min: '9.71', max: '9.91' });
    expect(toCanvasCalculation(fixed({ calculationFormula: '200', calculationTolerance: { mode: 'percent', value: 5 } })).answer)
      .toEqual({ exact: '200', min: '190', max: '210' });
    // A rounded answer: the absolute margin grows by the gap to 0.33 (rounded
    // up), and a percent is measured from the exact value, as in GRASP.
    expect(toCanvasCalculation(fixed({ calculationFormula: '1/3', calculationTolerance: { mode: 'absolute', value: 0.01 } })).answer)
      .toEqual({ exact: '0.33', min: '0.316', max: '0.344' });
    expect(toCanvasCalculation(fixed({ calculationFormula: '1/3', calculationTolerance: { mode: 'percent', value: 5 } })).answer)
      .toEqual({ exact: '0.333333', min: '0.316666', max: '0.35' });
    expect(toCanvasCalculation(fixed({ calculationFormula: '11', calculationTolerance: { mode: 'range', min: 10, max: 12 } })).answer)
      .toEqual({ min: '10', max: '12' });
  });

  test('a percent tolerance on an answer of 0 accepts what rounds to 0, as GRASP does', () => {
    expect(toCanvasCalculation(fixed({ calculationFormula: '0', calculationTolerance: { mode: 'percent', value: 5 } })).answer)
      .toEqual({ exact: '0', min: '-0.005', max: '0.005' });
  });
});

describe('questions Canvas cannot represent are left out with the reason', () => {
  const reason = (overrides) => toCanvasCalculation(calc(overrides)).skip;

  test.each([
    ['sinh(m) / v', 'The formula uses sinh(), which Canvas doesn\'t support.'],
    ['roundTo(m / v, 1)', 'The formula uses roundTo(), which Canvas doesn\'t support.'],
    ['m % v', 'The formula can\'t be written for Canvas: the character "%" isn\'t allowed in a formula.'],
  ])('formula %s', (formula, expected) => {
    expect(reason({ calculationFormula: formula })).toBe(expected);
  });

  test('variable names Canvas cannot use', () => {
    const named = (name) => reason({
      stem: `Twice {{${name}}}?`,
      calculationFormula: `2*${name}`,
      calculationVariables: [{ name, min: 1, max: 5, integerOnly: true }],
    });
    expect(named('v_0')).toBe('The variable name "v_0" isn\'t one Canvas can use: Canvas variable names are letters and digits, starting with a letter.');
    expect(named('mean')).toBe('The variable name "mean" is also the name of a Canvas formula function or constant.');
    expect(named('v0')).toBeUndefined();
  });

  test('a variable name written out in brackets, which Canvas would fill in', () => {
    expect(reason({ stem: 'Rate = k[m] where [m] = {{m}} and v = {{v}}' }))
      .toBe('The question text has "[m]" written out, which Canvas would replace with a value of the variable m.');
    // Other bracketed text is fine: chemistry stems write concentrations as [A].
    expect(reason({ stem: '[A] is {{m}} g in {{v}} L' })).toBeUndefined();
  });

  test('a range tolerance with variables', () => {
    expect(reason({ calculationTolerance: { mode: 'range', min: 1, max: 2 } }))
      .toBe('A range tolerance needs a fixed answer, and this question has variables.');
  });

  test("a formula Canvas's calculator works out differently", () => {
    // Canvas's fact() drops the fraction; GRASP's fac() of 1.4 is Γ(2.4).
    expect(reason({ stem: '{{x}} factorial?', calculationFormula: 'fac(x)', calculationVariables: [{ name: 'x', min: 1, max: 4, decimals: 1 }] }))
      .toMatch(/^The formula written for Canvas \(fact\(x\)\) doesn't match GRASP's: at x = \d\.\d Canvas's calculator gives /);
  });

  test('no finite answer anywhere in the ranges', () => {
    expect(reason({ calculationFormula: 'sqrt(-m) * v' })).toMatch(/^No values in the variables' ranges give the formula a finite answer/);
  });

  test('no formula, or a fixed answer that is not a number', () => {
    expect(reason({ calculationFormula: '  ' })).toBe('The question has no formula.');
    expect(reason({ calculationFormula: '1/0', calculationVariables: [] })).toMatch(/^The answer isn't a number GRASP can work out/);
  });
});
