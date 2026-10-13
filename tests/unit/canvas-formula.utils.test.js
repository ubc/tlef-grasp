/**
 * Canvas <-> GRASP formula translation (utils/canvas-formula.js, #130).
 *
 * The forward direction is what the Canvas quiz import uses; each rule is
 * also checked numerically through expr-eval, since a translation that parses
 * but means something else (log base 10 read as natural log) is the failure
 * this module exists to prevent. The reverse direction is for the QTI export.
 */

const { Parser } = require('expr-eval');
const {
  canvasFormulaToGrasp,
  graspFormulaToCanvas,
  canvasPlaceholdersToGrasp,
  graspPlaceholdersToCanvas,
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
    ['round(x, 2) + round(y) + abs(x) + ceil(y) + floor(x) + sqrt(y)', ['x', 'y'], 'roundTo(x, 2)+round(y)+abs(x)+ceil(y)+floor(x)+sqrt(y)'],
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
    ['round(x, 2)', { x: 2.345 }, 2.35],
    ['10^-5 * x', { x: 2 }, 2e-5],
    ['-x^2', { x: 3 }, -9],
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
    ['max()', ['x'], 'max() needs at least one argument'],
    ['pi(2)', ['x'], 'pi() takes 0 arguments, not 1'],
    ['(x, 2)', ['x'], 'a comma outside a function call'],
    ['sqrt(x', ['x'], 'a "(" is never closed'],
    ['x)', ['x'], 'a ")" with no "(" before it'],
    ['sqrt(x,)', ['x'], 'an empty function argument'],
    ['x % 2', ['x'], 'the character "%" isn\'t allowed in a formula'],
    ['x = 2', ['x'], 'the character "=" isn\'t allowed in a formula'],
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
