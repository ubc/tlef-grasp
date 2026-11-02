/**
 * Canvas <-> GRASP formula translation (utils/canvas-formula.js, #130).
 *
 * The forward direction is what the Canvas quiz import uses; each rule is
 * also checked numerically through expr-eval, since a translation that parses
 * but means something else (log base 10 read as natural log) is the failure
 * this module exists to prevent. Both directions are checked against
 * evaluateCanvasFormula, which follows Canvas's own calculator (Classic
 * Quizzes calcCmd.js; every case below was also run through calcCmd.js from a
 * local Canvas, with the same results).
 */

const { Parser } = require('expr-eval-fork');
const {
  canvasFormulaToGrasp,
  graspFormulaToCanvas,
  canvasPlaceholdersToGrasp,
  graspPlaceholdersToCanvas,
  evaluateCanvasFormula,
  FormulaError,
  UNSUPPORTED_CANVAS_FUNCTIONS,
} = require('../../src/utils/canvas-formula');

const evaluate = (formula, values = {}) => new Parser().parse(formula).evaluate(values);

describe('canvasFormulaToGrasp', () => {
  test.each([
    // Real shapes from the CHEM 123 export.
    ['-1.0*log(x,10)', ['x'], '-1.0*log10(x)'],
    ['14+log(sqrt((x/y)*1000*1.8*10^-5))', ['x', 'y'], '14+log10(sqrt((x/y)*1000*1.8*10^-5))'],
    ['14 + log(5.55*10^-10*(y*s/(x*r-y*s)))', ['x', 'r', 'y', 's'], '14+log10(5.55*10^-10*(y*s/(x*r-y*s)))'],
    ['-457.22+((8.314/1000)*(a+273.15)*(ln(z*z/(y*x*x))))', ['a', 'x', 'y', 'z'], '-457.22+((8.314/1000)*(a+273.15)*(ln(z*z/(y*x*x))))'],
    ['e^((x*1000/8.314)*(1/298-1/z)+ln(y))', ['x', 'y', 'z'], 'E^((x*1000/8.314)*(1/298-1/z)+ln(y))'],
    ['100*(1/(1+e^(-1000*x/(8.314*298))))', ['x'], '100*(1/(1+E^(-1000*x/(8.314*298))))'],
    ['(5/2)*x*8.314*(z-y)', ['x', 'y', 'z'], '(5/2)*x*8.314*(z-y)'],
    ['-x-y', ['x', 'y'], '-x-y'],
    // Other bases, constants and functions Canvas documents.
    ['log(x, 2)', ['x'], 'log2(x)'],
    ['log(x, 3)', ['x'], '(ln(x)/ln(3))'],
    ['log(x, y)', ['x', 'y'], '(ln(x)/ln(y))'],
    ['pi*r^2 + e()', ['r'], 'PI*r^2+E'],
    ['pi() * fact(n)', ['n'], 'PI*fac(n)'],
    ['deg_to_rad(x) + rad_to_deg(y)', ['x', 'y'], '((x)*PI/180)+((y)*180/PI)'],
    ['round(x, 2) + round(y) + abs(x) + ceil(y) + floor(x) + sqrt(y)', ['x', 'y'], 'round(x)+round(y)+abs(x)+ceil(y)+floor(x)+sqrt(y)'],
    ['max(x, y, 2) - min(x, y)', ['x', 'y'], 'max(x, y, 2)-min(x, y)'],
    ['sin(x)+cos(x)+tan(x)+asin(y)+acos(y)+atan(y)', ['x', 'y'], 'sin(x)+cos(x)+tan(x)+asin(y)+acos(y)+atan(y)'],
    // Canvas reads two operands in a row as a product.
    ['-1*sqrt(5x)', ['x'], '-1*sqrt(5*x)'],
    ['2(x+1)(y)', ['x', 'y'], '2*(x+1)*(y)'],
    ['x y', ['x', 'y'], 'x*y'],
    // A variable named like a Canvas function or constant keeps its meaning.
    ['e*2', ['e'], 'e*2'],
    ['log*2', ['log'], 'log*2'],
  ])('translates %s', (canvas, variables, grasp) => {
    expect(canvasFormulaToGrasp(canvas, variables)).toEqual({ formula: grasp });
  });

  test.each([
    // The log trap: Canvas log is base 10, expr-eval log is natural.
    ['log(x)', { x: 1000 }, 3],
    ['log(x, 10)', { x: 0.088 }, Math.log10(0.088)],
    ['log(x, 3)', { x: 81 }, 4],
    ['log(x, 2)', { x: 8 }, 3],
    ['ln(x)', { x: Math.E ** 2 }, 2],
    ['e^x', { x: 2 }, Math.exp(2)],
    ['e()^x', { x: 2 }, Math.exp(2)],
    ['pi * x', { x: 2 }, 2 * Math.PI],
    ['fact(x)', { x: 5 }, 120],
    ['deg_to_rad(x)', { x: 180 }, Math.PI],
    ['rad_to_deg(x)', { x: Math.PI / 2 }, 90],
    // Canvas's round() ignores a second argument.
    ['round(x, 2)', { x: 2.345 }, 2],
    ['10^-5 * x', { x: 2 }, 2e-5],
    ['5x', { x: 3 }, 15],
    ['100*(y+x)/(2*x)', { x: 60, y: -1 }, 49.166666666666664],
  ])('%s evaluates as Canvas does', (canvas, values, expected) => {
    const { formula } = canvasFormulaToGrasp(canvas, Object.keys(values));
    expect(evaluate(formula, values)).toBeCloseTo(expected, 10);
  });

  test.each([
    ['mean(x, 2)', ['x'], 'uses mean(), which GRASP doesn\'t support'],
    ['rand(1, 6) + x', ['x'], 'uses rand(), which GRASP doesn\'t support'],
    ['if(x, 1, 2)', ['x'], 'uses if(), which GRASP doesn\'t support'],
    ['mod(x, 2)', ['x'], 'uses mod(), which GRASP doesn\'t support'],
    ['sinh(x)', ['x'], 'uses sinh(), which GRASP doesn\'t support'],
    ['frobnicate(x)', ['x'], 'uses frobnicate(), which GRASP doesn\'t support'],
    ['2*k', ['x'], 'uses "k", which isn\'t one of the question\'s variables'],
    ['x(2)', ['x'], 'uses the variable "x" like a function'],
    ['log()', ['x'], 'log() takes 1 or 2 arguments, not 0'],
    ['log(x, 2, 3)', ['x'], 'log() takes 1 or 2 arguments, not 3'],
    ['sqrt(x, 2)', ['x'], 'sqrt() takes 1 argument, not 2'],
    // Canvas works out round's second argument before ignoring it.
    ['round(x, k)', ['x'], 'uses "k", which isn\'t one of the question\'s variables'],
    ['round(x, 2, 3)', ['x'], 'round() takes 1 argument, not 3'],
    ['max()', ['x'], 'max() needs at least one argument'],
    ['pi(2)', ['x'], 'pi() takes 0 arguments, not 1'],
    ['(x, 2)', ['x'], 'a comma outside a function call'],
    ['sqrt(x', ['x'], 'a "(" is never closed'],
    ['x)', ['x'], 'a ")" with no "(" before it'],
    ['sqrt(x,)', ['x'], 'an empty function argument'],
    ['x % 2', ['x'], 'the character "%" isn\'t allowed in a formula'],
    ['x = 2', ['x'], 'the character "=" isn\'t allowed in a formula'],
    ['x+', ['x'], 'an operator with nothing after it'],
    ['2^', ['x'], 'an operator with nothing after it'],
    ['*x', ['x'], 'a "*" with nothing before it'],
    ['1.2.3*x', ['x'], '"1.2.3" is not a number'],
    ['', ['x'], 'the formula is empty'],
    ['   ', ['x'], 'the formula is empty'],
  ])('refuses %s by name', (canvas, variables, error) => {
    expect(canvasFormulaToGrasp(canvas, variables)).toEqual({ error });
  });

  test('names every Canvas list and random function as unsupported', () => {
    for (const name of UNSUPPORTED_CANVAS_FUNCTIONS) {
      expect(canvasFormulaToGrasp(`${name}(x)`, ['x'])).toEqual({ error: `uses ${name}(), which GRASP doesn't support` });
    }
  });
});

describe("canvasFormulaToGrasp: a minus and ^ as Canvas's calculator reads them", () => {
  // Canvas negates only the number or name after "-", ahead of ^, and works
  // each level left to right; expr-eval reads -x^2 as -(x^2) and 2^3^2 as
  // 2^(3^2). The GRASP formula must give what Canvas's calculator gives.
  const values = { x: 1.3, y: 0.4, a: 2, b: 7, c: 1.5, p: 4 };
  const names = Object.keys(values);
  test.each([
    ['-x^2', '(-x)^2'],
    ['-2^2', '(-2)^2'],
    ['2^3^2', '(2^3)^2'],
    ['x^-2', 'x^-2'],
    ['a/b*c', 'a/b*c'],
    ['a-b-c', 'a-b-c'],
    ['-x*y', '-x*y'],
    ['e^(-x^2/2)', 'E^((-x)^2/2)'],
    ['10^-p', '10^-p'],
    ['x^-y^2', '(x^-y)^2'],
    ['a*-b^2', 'a*(-b)^2'],
    ['a--b^2', 'a-(-b)^2'],
    ['a/(b*c)', 'a/(b*c)'],
    ['a^(b^c)', 'a^(b^c)'],
  ])('%s is written %s, which expr-eval works out as Canvas does', (canvas, grasp) => {
    expect(canvasFormulaToGrasp(canvas, names)).toEqual({ formula: grasp });
    expect(evaluate(grasp, values)).toBeCloseTo(evaluateCanvasFormula(canvas, values), 12);
  });

  test('the real export formulas work out as Canvas does', () => {
    const real = [
      '-1.0*log(x,10)',
      '14+log(sqrt((x/y)*1000*1.8*10^-5))',
      '14 + log(5.55*10^-10*(y*s/(x*r-y*s)))',
      '-457.22+((8.314/1000)*(a+273.15)*(ln(z*z/(y*x*x))))',
      'e^((x*1000/8.314)*(1/298-1/z)+ln(y))',
      '100*(1/(1+e^(-1000*x/(8.314*298))))',
      '(5/2)*x*8.314*(z-y)',
      '-x-y',
      'w*0.08206*(z-x)/y',
    ];
    const chem = { a: 25, r: 0.3, s: 0.2, w: 1.7, x: 0.5, y: 0.15, z: 310 };
    for (const canvas of real) {
      const { formula } = canvasFormulaToGrasp(canvas, Object.keys(chem));
      expect(evaluate(formula, chem) / evaluateCanvasFormula(canvas, chem)).toBeCloseTo(1, 12);
    }
  });

  // Canvas's calculator can't read these, so it recorded no answers from
  // them; the usual reading stands, and the import's recorded-answer check
  // catches a question whose answers came from somewhere else.
  test.each([
    ['-(a+b)', '-(a+b)', -9],
    ['-log(x)', '-log10(x)', -Math.log10(1.3)],
    ['-(a+b)^2', '-(a+b)^2', -81],
    ['--x', '--x', 1.3],
    ['2x^2', '2*x^2', 3.38],
  ])('%s, an error in Canvas, keeps its usual reading: %s', (canvas, grasp, value) => {
    expect(() => evaluateCanvasFormula(canvas, values)).toThrow(FormulaError);
    expect(canvasFormulaToGrasp(canvas, names)).toEqual({ formula: grasp });
    expect(evaluate(grasp, values)).toBeCloseTo(value, 12);
  });

  test('reads an earlier line\'s name as Canvas does, so a minus before it negates its value', () => {
    // Canvas works out k = 2*x and stores the value: -k^2 is then (-2x)^2.
    const negated = canvasFormulaToGrasp('-k^2', ['x'], { definitions: [['k', '2*x']] });
    expect(negated).toEqual({ formula: '(-(2*x))^2' });
    expect(evaluate(negated.formula, { x: 3 })).toBe(36);
    expect(canvasFormulaToGrasp('m*k', ['x'], { definitions: [['k', '2*x'], ['m', 'k + 1']] })).toEqual({ formula: '((2*x)+1)*(2*x)' });
    // A line sees only the lines above it: x = x*2 redefines the variable.
    expect(canvasFormulaToGrasp('x+1', ['x'], { definitions: [['x', 'x*2']] })).toEqual({ formula: '(x*2)+1' });
    expect(canvasFormulaToGrasp('k', ['x'], { definitions: [['k', 'j'], ['j', 'x']] })).toEqual({ error: 'uses "j", which isn\'t one of the question\'s variables' });
  });
});

describe('graspFormulaToCanvas', () => {
  test.each([
    ['-1.0*log10(x)', ['x'], '-1.0*log(x)'],
    ['lg(x)', ['x'], 'log(x)'],
    ['log(x)', ['x'], 'ln(x)'],
    ['ln(x)', ['x'], 'ln(x)'],
    ['log2(x)', ['x'], '(ln(x)/ln(2))'],
    ['E^(x) + PI*r^2', ['x', 'r'], 'e^(x)+pi*r^2'],
    ['e^x + pi', ['x'], 'e^x+pi'],
    ['fac(n)', ['n'], 'fact(n)'],
    ['exp(x)', ['x'], '(e^(x))'],
    ['pow(x, 3)', ['x'], '((x)^(3))'],
    ['roundTo(x, 2)', ['x'], null],
    ['sinh(x)', ['x'], null],
    ['trunc(x)', ['x'], null],
    ['sign(x)', ['x'], null],
    ['cbrt(x)', ['x'], null],
    ['x % 2', ['x'], null],
  ])('translates %s for Canvas, or refuses it', (grasp, variables, canvas) => {
    const result = graspFormulaToCanvas(grasp, variables);
    if (canvas === null) expect(result.error).toMatch(/which Canvas doesn't support|isn't allowed/);
    else expect(result).toEqual({ formula: canvas });
  });

  // expr-eval reads 6.022e23 as one number; Canvas has no e-notation (in a
  // Canvas formula, "2e3" is not a number), so it is written as a power of ten.
  test.each([
    ['6.022e23*n', ['n'], '(6.022*10^(23))*n'],
    ['1.5E-3 + x', ['x'], '(1.5*10^(-3))+x'],
    ['x*2e+3', ['x'], 'x*(2*10^(3))'],
    ['2E*x', ['x'], '2*e*x'],
  ])('writes e-notation %s as a power of ten', (grasp, variables, canvas) => {
    expect(graspFormulaToCanvas(grasp, variables)).toEqual({ formula: canvas });
    const values = Object.fromEntries(variables.map((name) => [name, 3]));
    const back = canvasFormulaToGrasp(canvas, variables).formula;
    expect(evaluate(back, values)).toBeCloseTo(evaluate(grasp.replace(/^2E/, '2*E'), values), 9);
  });

  test('the Canvas direction still refuses e-notation', () => {
    expect(canvasFormulaToGrasp('2e3*x', ['x'])).toEqual({ error: 'uses "e3", which isn\'t one of the question\'s variables' });
  });

  test('round-trips the real export formulas', () => {
    const real = [
      ['-1.0*log(x,10)', ['x'], '-1.0*log(x)'],
      ['14+log(sqrt((x/y)*1000*1.8*10^-5))', ['x', 'y']],
      ['e^((x*1000/8.314)*(1/298-1/z)+ln(y))', ['x', 'y', 'z']],
      ['w*0.08206*(z-x)/y', ['w', 'x', 'y', 'z']],
      ['-457.22+((8.314/1000)*(a+273.15)*(ln(z*z/(y*x*x))))', ['a', 'x', 'y', 'z']],
    ];
    for (const [canvas, variables, back = canvas] of real) {
      const grasp = canvasFormulaToGrasp(canvas, variables).formula;
      expect(graspFormulaToCanvas(grasp, variables)).toEqual({ formula: back });
    }
  });
});

describe("graspFormulaToCanvas: a minus and ^ as Canvas's calculator reads them", () => {
  // expr-eval reads -x^2 as -(x^2) and 2^3^2 as 2^(3^2); Canvas negates only
  // the number or name after "-" and works ^ left to right.
  test.each([
    ['-log10(h)', '-1*log(h)'],
    ['-x^2', '-1*x^2'],
    ['-(a+b)', '-1*(a+b)'],
    ['E^(-x^2/2)', 'e^(-1*x^2/2)'],
    ['2^x^2', '2^(x^2)'],
    ['(-x)^2', '(-x)^2'],
    ['10^-x', '10^-x'],
    ['-x*y', '-x*y'],
    ['a/(b*c)', 'a/(b*c)'],
    ['a - (b - c)', 'a-(b-c)'],
    ['-exp(-x)', '-1*(e^(-x))'],
  ])('%s is written %s, which Canvas works out the same', (grasp, canvas) => {
    const values = { x: 1.3, y: 0.4, h: 0.002, a: 2, b: 7, c: 1.5 };
    const names = Object.keys(values);
    expect(graspFormulaToCanvas(grasp, names)).toEqual({ formula: canvas });
    expect(evaluateCanvasFormula(canvas, values)).toBeCloseTo(evaluate(grasp, values), 12);
  });
});

describe("evaluateCanvasFormula: Canvas's calculator rules", () => {
  const values = { x: 3, y: 0.5, a: 2, b: 7, z: 0 };
  test.each([
    ['-x^2', 9],
    ['-2^2', 4],
    ['2^3^2', 64],
    ['x*-y', -1.5],
    ['a--b', 9],
    ['a/b*a', 4 / 7],
    ['log(100)', 2],
    ['log(8, 2)', 3],
    ['ln(e)', 1],
    ['fact(3.7)', 6],
    ['e(2)', Math.exp(2)],
    ['pi()', Math.PI],
    ['round(2.5)', 3],
    ['max(1, b, a)', 7],
    ['deg_to_rad(180)', Math.PI],
    ['z + 1', 1],
    ['(6.022*10^(23))*a', 1.2044e24],
  ])('%s = %d', (formula, expected) => {
    expect(evaluateCanvasFormula(formula, values) / expected).toBeCloseTo(1, 12);
  });

  test.each([
    ['-log(x)', /a minus before a function/],
    ['-(x+1)', /a number or a name after "-"/],
    ['2x', /doesn't expect/],
    ['2(x)', /doesn't expect/],
    ['5.+x', /can't read "\."/],
    ['sinh(x)', /no function sinh/],
    ['w', /no variable "w"/],
  ])('%s is an error, as in Canvas', (formula, message) => {
    expect(() => evaluateCanvasFormula(formula, values)).toThrow(FormulaError);
    expect(() => evaluateCanvasFormula(formula, values)).toThrow(message);
  });
});

describe('placeholders', () => {
  test('rewrites [name] only for declared names, leaving chemistry brackets alone', () => {
    expect(canvasPlaceholdersToGrasp('The [A] of [x] and [x1] at [y]º; [X] too.', ['x', 'y'])).toBe(
      'The [A] of {{x}} and [x1] at {{y}}º; [X] too.',
    );
    expect(canvasPlaceholdersToGrasp('[x] [x]', ['x'])).toBe('{{x}} {{x}}');
    expect(canvasPlaceholdersToGrasp(null, ['x'])).toBe('');
  });

  test('rewrites {{name}} back to [name], spaces inside allowed', () => {
    expect(graspPlaceholdersToCanvas('{{ x }} and {{y}} but {{z}} and {{ x}}', ['x', 'y'])).toBe('[x] and [y] but {{z}} and [x]');
  });
});
