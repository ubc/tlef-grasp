/**
 * Canvas formula-question dialect <-> GRASP calculation formulas (#130).
 *
 * Canvas Classic formula questions and GRASP calculation questions are the same
 * idea (a formula over randomly sampled variables), but they speak different
 * dialects. The dangerous differences are the ones that parse fine and give a
 * plausible wrong answer key, so every rewrite here is explicit and anything not
 * recognised is reported by name instead of passed through:
 *
 *   Canvas              GRASP (expr-eval)
 *   log(x)              log10(x)          Canvas log is base 10; expr-eval's is natural
 *   log(x, 10)          log10(x)
 *   log(x, 2)           log2(x)
 *   log(x, b)           (ln(x)/ln(b))
 *   ln(x)               ln(x)
 *   e, e(), pi, pi()    E, PI
 *   fact(n)             fac(n)
 *   deg_to_rad(x)       ((x)*PI/180)
 *   rad_to_deg(x)       ((x)*180/PI)
 *   round(x, n)         roundTo(x, n)
 *   abs ceil floor sqrt sin cos tan asin acos atan max min round   unchanged
 *   -x^2, -2^2          (-x)^2, (-2)^2    Canvas's "-" belongs to the number or name after it
 *   2^3^2               (2^3)^2           Canvas works ^ left to right; expr-eval right to left
 *   + - * / ( )         unchanged
 *   5x, 2(x+1), (a)(b)  5*x, 2*(x+1), (a)*(b)   read as a product (an error in Canvas's calculator)
 *
 * Canvas's list and random functions (mean, sum, rand, count, if, ...) have no
 * GRASP equivalent: a formula using one is refused, naming the function.
 *
 * Placeholders: Canvas writes a variable in the question text as [x], GRASP as
 * {{x}}. Only declared names are rewritten, because chemistry stems are full of
 * [A], [H+] and the like.
 */

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const NUMBER = /^(?:\d+\.?\d*|\.\d+)$/;

// Canvas functions GRASP has under the same name, with the argument counts
// expr-eval accepts for them.
const SAME_NAME = Object.freeze({
  abs: [1], ceil: [1], floor: [1], sqrt: [1],
  sin: [1], cos: [1], tan: [1], asin: [1], acos: [1], atan: [1],
  max: null, min: null, // any number of arguments
  round: [1],
});

// Canvas functions with no GRASP equivalent, by name. Anything not listed
// anywhere is refused too; this list only exists for the tests and the reader.
const UNSUPPORTED_CANVAS = new Set([
  'if', 'rand', 'mean', 'median', 'sum', 'count', 'first', 'last', 'length',
  'range', 'reverse', 'sort', 'comb', 'perm', 'mod', 'int',
]);

// expr-eval functions Canvas has under the same name, for the reverse direction.
const SAME_NAME_BACK = new Set(['abs', 'ceil', 'floor', 'sqrt', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'max', 'min', 'round']);

class FormulaError extends Error {}

// ---- Tokens and a tiny call tree -------------------------------------------------
//
// A formula is read into a flat list of tokens, then into a tree where only
// function calls and parenthesised groups nest. The two dialects read a minus
// and ^ differently, so each direction then reads the operators with its
// source's rules (canvasTree, toTree) and writes them with the parentheses the
// target needs.

// `exponents` reads e-notation ("6.022e23", "1.5E-3") as one number, as
// expr-eval does. Only GRASP formulas are read that way: in Canvas, "2e3" is
// not a number.
function tokenize(formula, { exponents = false } = {}) {
  const tokens = [];
  const text = String(formula);
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let j = i + 1;
      while (j < text.length && /[0-9.]/.test(text[j])) j += 1;
      const value = text.slice(i, j);
      if (!NUMBER.test(value)) throw new FormulaError(`"${value}" is not a number`);
      const exponent = exponents ? text.slice(j).match(/^[eE]([+-]?\d+)/) : null;
      if (exponent) {
        tokens.push({ type: 'number', value, exponent: String(Number(exponent[1])) });
        i = j + exponent[0].length;
        continue;
      }
      tokens.push({ type: 'number', value });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i + 1;
      while (j < text.length && /[A-Za-z0-9_]/.test(text[j])) j += 1;
      tokens.push({ type: 'ident', value: text.slice(i, j) });
      i = j;
      continue;
    }
    if ('+-*/^'.includes(ch)) tokens.push({ type: 'op', value: ch });
    else if (ch === '(') tokens.push({ type: 'open' });
    else if (ch === ')') tokens.push({ type: 'close' });
    else if (ch === ',') tokens.push({ type: 'comma' });
    else throw new FormulaError(`the character "${ch}" isn't allowed in a formula`);
    i += 1;
  }
  return tokens;
}

// Nodes until a ")" or "," at this level (not consumed) or the end.
function readSequence(tokens, state) {
  const nodes = [];
  while (state.i < tokens.length) {
    const token = tokens[state.i];
    if (token.type === 'close' || token.type === 'comma') break;
    state.i += 1;
    if (token.type === 'ident' && tokens[state.i] && tokens[state.i].type === 'open') {
      state.i += 1;
      nodes.push({ type: 'call', name: token.value, args: readArgs(tokens, state) });
    } else if (token.type === 'open') {
      const args = readArgs(tokens, state);
      if (args.length !== 1) throw new FormulaError('a comma outside a function call');
      nodes.push({ type: 'group', inner: args[0] });
    } else {
      nodes.push(token);
    }
  }
  return nodes;
}

// Argument sequences up to and including the matching ")". "f()" is zero arguments.
function readArgs(tokens, state) {
  const args = [];
  for (;;) {
    const sequence = readSequence(tokens, state);
    const token = tokens[state.i];
    if (!token) throw new FormulaError('a "(" is never closed');
    state.i += 1;
    args.push(sequence);
    if (token.type === 'close') break;
  }
  if (args.length === 1 && args[0].length === 0) return [];
  if (args.some((arg) => arg.length === 0)) throw new FormulaError('an empty function argument');
  return args;
}

function parse(formula, options) {
  const tokens = tokenize(formula, options);
  const state = { i: 0 };
  const nodes = readSequence(tokens, state);
  if (state.i < tokens.length) throw new FormulaError('a ")" with no "(" before it');
  if (nodes.length === 0) throw new FormulaError('the formula is empty');
  return nodes;
}

function isLiteral(sequence, value) {
  return sequence.length === 1 && sequence[0].type === 'number' && Number(sequence[0].value) === value;
}

function checkArity(name, args, allowed) {
  if (allowed && !allowed.includes(args.length)) {
    throw new FormulaError(`${name}() takes ${allowed.join(' or ')} argument${allowed[0] === 1 && allowed.length === 1 ? '' : 's'}, not ${args.length}`);
  }
  if (!allowed && args.length === 0) throw new FormulaError(`${name}() needs at least one argument`);
}

// ---- Canvas -> GRASP ---------------------------------------------------------------
//
// Canvas's formula calculator (Classic Quizzes, calcCmd.js) reads two things
// differently from expr-eval, so a Canvas formula is read into a tree with
// Canvas's rules and written with the parentheses expr-eval needs:
//   - a "-" before a number or a name belongs to it alone, ahead of ^:
//     Canvas's -x^2 is (-x)^2 and x^-2 is x^(-2); expr-eval's -x^2 is -(x^2).
//   - ^, then * /, then + -, each worked out left to right: Canvas's 2^3^2 is
//     (2^3)^2; expr-eval's is 2^(3^2).
// Where Canvas's calculator reports an error, the usual reading stands:
//   - two operands in a row are a product (5x, 2(x+1)), as decided in #170;
//   - a "-" before "(", a function or another sign negates what follows up to
//     the next * / + or -, as in ordinary maths: -(a+b) and -log(x) are
//     negated whole, -(a+b)^2 is -((a+b)^2). Canvas can't work these out, so
//     no answers it recorded came from them; the import's check against the
//     recorded answers (checkFormulaAgainstCanvas) leaves such a question a
//     Draft when they disagree or are missing.

// Writing levels for expr-eval, loosest first: + - < * / < unary - < ^ <
// atoms (2, x, f(x), (...)). A part goes into a slot without parentheses when
// its level is at least the slot's.
const GRASP_ADD = 0;
const GRASP_MUL = 1;
const GRASP_NEG = 2;
const GRASP_POW = 3;
const GRASP_ATOM = 4;

// The flat nodes of one sequence as an expression tree, with Canvas's rules
// (above). `defined` maps a name from an earlier formula line to its tree.
function canvasTree(nodes, defined) {
  let i = 0;
  const peek = () => nodes[i];
  const isOp = (node, ops) => Boolean(node) && node.type === 'op' && ops.includes(node.value);
  // A "-" that Canvas reads as part of the number or name right after it.
  const attachedMinus = () => isOp(peek(), '-') && ['number', 'ident'].includes(nodes[i + 1]?.type);
  const operand = () => {
    const node = nodes[i];
    if (!node || node.type === 'op') throw new FormulaError(node ? `a "${node.value}" with nothing before it` : 'an operator with nothing after it');
    i += 1;
    if (node.type === 'group') return { type: 'group', inner: canvasTree(node.inner, defined) };
    if (node.type === 'ident' && defined.has(node.value)) return { type: 'group', inner: defined.get(node.value) };
    return node;
  };
  const factor = () => {
    if (!attachedMinus()) return operand();
    i += 1;
    return { type: 'neg', inner: operand() };
  };
  // Any other sign: "+" is dropped, "-" negates the power after it.
  const signed = () => {
    if (isOp(peek(), '+')) {
      i += 1;
      return signed();
    }
    if (isOp(peek(), '-') && !attachedMinus()) {
      i += 1;
      return { type: 'neg', inner: signed() };
    }
    return power();
  };
  const power = () => {
    let left = factor();
    while (isOp(peek(), '^')) {
      i += 1;
      const right = isOp(peek(), '+-') && !attachedMinus() ? signed() : factor();
      left = { type: 'binary', op: '^', left, right };
    }
    return left;
  };
  const product = () => {
    let left = signed();
    for (;;) {
      const next = peek();
      if (isOp(next, '*/')) {
        i += 1;
        left = { type: 'binary', op: next.value, left, right: signed() };
      } else if (next && next.type !== 'op') {
        left = { type: 'binary', op: '*', left, right: signed() };
      } else {
        return left;
      }
    }
  };
  const sum = () => {
    let left = product();
    while (isOp(peek(), '+-')) {
      const { value } = nodes[i];
      i += 1;
      left = { type: 'binary', op: value, left, right: product() };
    }
    return left;
  };
  const tree = sum();
  if (i < nodes.length) throw new FormulaError(`a "${nodes[i].value}" with nothing after it`);
  return tree;
}

/**
 * Translate a Canvas formula to a GRASP calculation formula.
 *
 * @param {string} formula  as written in the export (one line)
 * @param {string[]} variableNames  the question's declared variable names
 * @param {{ definitions?: Array<[string, string]> }} [options]  earlier formula
 *   lines ("k = 2*x" as ['k', '2*x']), in order; each is put in where its name
 *   is used, read as Canvas reads a name (k = 2*x, then -k^2, is (-2x)^2)
 * @returns {{ formula: string } | { error: string }}  the error is a sentence
 *   fragment ("uses rand(), which GRASP doesn't support") for a skip reason
 */
function canvasFormulaToGrasp(formula, variableNames = [], { definitions = [] } = {}) {
  const declared = new Set(variableNames);
  const defined = new Map();
  const atom = (text) => ({ text, level: GRASP_ATOM });
  // A part in a slot of the given level, in parentheses when it is looser.
  const slot = (part, level) => (part.level >= level ? part.text : `(${part.text})`);

  const write = (node) => {
    switch (node.type) {
      case 'number':
        return atom(node.value);
      case 'ident':
        if (declared.has(node.value)) return atom(node.value);
        if (node.value === 'e') return atom('E');
        if (node.value === 'pi') return atom('PI');
        throw new FormulaError(`uses "${node.value}", which isn't one of the question's variables`);
      case 'group':
        return atom(`(${write(node.inner).text})`);
      case 'call':
        return atom(writeCall(node));
      case 'neg':
        return { text: `-${slot(write(node.inner), GRASP_NEG)}`, level: GRASP_NEG };
      case 'binary': {
        const left = write(node.left);
        const right = write(node.right);
        // expr-eval works ^ right to left and the rest left to right, so a
        // same-level part on the other side is bracketed: (a^b)^c, a/(b*c), a-(b+c).
        if (node.op === '^') return { text: `${slot(left, GRASP_ATOM)}^${slot(right, GRASP_NEG)}`, level: GRASP_POW };
        if (node.op === '*' || node.op === '/') return { text: `${slot(left, GRASP_MUL)}${node.op}${slot(right, GRASP_NEG)}`, level: GRASP_MUL };
        return { text: `${slot(left, GRASP_ADD)}${node.op}${slot(right, GRASP_MUL)}`, level: GRASP_ADD };
      }
      default:
        throw new FormulaError('an unexpected token');
    }
  };
  const argText = (args) => args.map((arg) => write(canvasTree(arg, defined)).text);
  const writeCall = ({ name, args }) => {
    if (declared.has(name)) throw new FormulaError(`uses the variable "${name}" like a function`);
    if (name === 'e' || name === 'pi') {
      checkArity(name, args, [0]);
      return name === 'e' ? 'E' : 'PI';
    }
    if (name === 'ln') {
      checkArity(name, args, [1]);
      return `ln(${argText(args)[0]})`;
    }
    if (name === 'log') {
      checkArity(name, args, [1, 2]);
      const [x, base] = argText(args);
      if (args.length === 1 || isLiteral(args[1], 10)) return `log10(${x})`;
      if (isLiteral(args[1], 2)) return `log2(${x})`;
      return `(ln(${x})/ln(${base}))`;
    }
    if (name === 'fact') {
      checkArity(name, args, [1]);
      return `fac(${argText(args)[0]})`;
    }
    if (name === 'deg_to_rad') {
      checkArity(name, args, [1]);
      return `((${argText(args)[0]})*PI/180)`;
    }
    if (name === 'rad_to_deg') {
      checkArity(name, args, [1]);
      return `((${argText(args)[0]})*180/PI)`;
    }
    if (name === 'round' && args.length === 2) return `roundTo(${argText(args).join(', ')})`;
    if (Object.prototype.hasOwnProperty.call(SAME_NAME, name)) {
      checkArity(name, args, SAME_NAME[name]);
      return `${name}(${argText(args).join(', ')})`;
    }
    throw new FormulaError(`uses ${name}(), which GRASP doesn't support`);
  };
  try {
    // Each line sees only the lines above it, as Canvas works them out in order.
    for (const [name, expression] of definitions) defined.set(name, canvasTree(parse(expression), defined));
    return { formula: write(canvasTree(parse(formula), defined)).text };
  } catch (error) {
    if (error instanceof FormulaError) return { error: error.message };
    throw error;
  }
}

// ---- GRASP -> Canvas ---------------------------------------------------------------
//
// Canvas's formula calculator (Classic Quizzes, calcCmd.js) reads two things
// differently from expr-eval, so a GRASP formula is read into a tree with
// expr-eval's precedence and written with the parentheses Canvas needs:
//   - "^" chains: expr-eval reads 2^3^2 as 2^(3^2); Canvas works left to right.
//   - unary minus: expr-eval reads -x^2 as -(x^2). Canvas only negates the
//     number or name right after the "-", so -x^2 is (-x)^2 there, and a "-"
//     before "(" or a function, as in -log(x), is a syntax error.
// Canvas also has no implicit products and no e-notation; both are written out.

// Writing levels, loosest first. A part goes into a slot without parentheses
// when its level is at least the slot's.
const ADD = 0; // a+b, a-b
const MUL = 1; // a*b, a/b
const POW = 2; // a^b
const NEG = 3; // -x, -2: a minus Canvas reads as part of the number or name
const ATOM = 4; // 2, x, f(x), (...)

// The flat nodes of one sequence as an expression tree, with expr-eval's
// precedence: + - < * / and juxtaposition < unary - + < ^ (right to left).
// The formula's own parentheses stay, so it reads as the instructor wrote it.
function toTree(nodes) {
  let i = 0;
  const peek = () => nodes[i];
  const isOp = (node, ops) => node && node.type === 'op' && ops.includes(node.value);
  const operand = () => {
    const node = nodes[i];
    if (!node || node.type === 'op') throw new FormulaError(node ? `a "${node.value}" with nothing before it` : 'an operator with nothing after it');
    i += 1;
    if (node.type === 'group') return { type: 'group', inner: toTree(node.inner) };
    return node;
  };
  const unary = () => {
    if (isOp(peek(), '-+')) {
      const { value } = nodes[i];
      i += 1;
      const inner = unary();
      return value === '-' ? { type: 'neg', inner } : inner;
    }
    const base = operand();
    if (isOp(peek(), '^')) {
      i += 1;
      return { type: 'binary', op: '^', left: base, right: unary() };
    }
    return base;
  };
  const product = () => {
    let left = unary();
    for (;;) {
      const next = peek();
      if (isOp(next, '*/')) {
        i += 1;
        left = { type: 'binary', op: next.value, left, right: unary() };
      } else if (next && next.type !== 'op') {
        left = { type: 'binary', op: '*', left, right: unary() };
      } else {
        return left;
      }
    }
  };
  const sum = () => {
    let left = product();
    while (isOp(peek(), '+-')) {
      const { value } = nodes[i];
      i += 1;
      left = { type: 'binary', op: value, left, right: product() };
    }
    return left;
  };
  const tree = sum();
  if (i < nodes.length) throw new FormulaError(`a "${nodes[i].value}" with nothing after it`);
  return tree;
}

// Canvas reads "5." as 5 followed by a stray ".".
const canvasNumber = (value) => (value.endsWith('.') ? value.slice(0, -1) : value);

/**
 * Translate a GRASP calculation formula to Canvas's dialect, for export.
 * Returns an error naming what Canvas cannot do (hyperbolic functions, roundTo,
 * trunc, sign, cbrt, %, ...). E-notation numbers are written as powers of ten.
 *
 * @param {string} formula  a stored GRASP formula (already canonical)
 * @param {string[]} variableNames
 * @returns {{ formula: string } | { error: string }}
 */
function graspFormulaToCanvas(formula, variableNames = []) {
  const declared = new Set(variableNames);
  const atom = (text) => ({ text, level: ATOM });
  // A part in a slot of the given level, in parentheses when it is looser.
  const slot = (part, level) => (part.level >= level ? part.text : `(${part.text})`);

  const write = (node) => {
    switch (node.type) {
      case 'number':
        // 6.022e23 -> (6.022*10^(23)): Canvas has no e-notation.
        return atom(node.exponent === undefined ? canvasNumber(node.value) : `(${canvasNumber(node.value)}*10^(${node.exponent}))`);
      case 'ident':
        if (declared.has(node.value)) return atom(node.value);
        if (node.value === 'E' || node.value === 'e') return atom('e');
        if (node.value === 'PI' || node.value === 'pi') return atom('pi');
        throw new FormulaError(`uses "${node.value}", which isn't one of the question's variables`);
      case 'call':
        return atom(writeCall(node));
      case 'group':
        return atom(`(${write(node.inner).text})`);
      case 'neg': {
        const inner = write(node.inner);
        // Canvas negates a number or a name in place; anything else is -1 times it.
        const simple = (node.inner.type === 'number' && node.inner.exponent === undefined) || node.inner.type === 'ident';
        return simple ? { text: `-${inner.text}`, level: NEG } : { text: `-1*${slot(inner, POW)}`, level: MUL };
      }
      case 'binary': {
        const left = write(node.left);
        const right = write(node.right);
        // Canvas works each level left to right, so a right-hand part of the
        // same level is bracketed: a^(b^c), a/(b*c), a-(b+c).
        if (node.op === '^') return { text: `${slot(left, ATOM)}^${slot(right, NEG)}`, level: POW };
        if (node.op === '*' || node.op === '/') return { text: `${slot(left, MUL)}${node.op}${slot(right, POW)}`, level: MUL };
        return { text: `${slot(left, ADD)}${node.op}${slot(right, MUL)}`, level: ADD };
      }
      default:
        throw new FormulaError('an unexpected token');
    }
  };
  const argText = (args) => args.map((arg) => write(toTree(arg)).text);
  const writeCall = ({ name, args }) => {
    if (declared.has(name)) throw new FormulaError(`uses the variable "${name}" like a function`);
    if (name === 'log' || name === 'ln') {
      checkArity(name, args, [1]);
      return `ln(${argText(args)[0]})`;
    }
    if (name === 'log10' || name === 'lg') {
      checkArity(name, args, [1]);
      return `log(${argText(args)[0]})`;
    }
    if (name === 'log2') {
      checkArity(name, args, [1]);
      return `(ln(${argText(args)[0]})/ln(2))`;
    }
    if (name === 'fac') {
      checkArity(name, args, [1]);
      return `fact(${argText(args)[0]})`;
    }
    if (name === 'pow') {
      checkArity(name, args, [2]);
      const [x, y] = argText(args);
      return `((${x})^(${y}))`;
    }
    if (name === 'exp') {
      checkArity(name, args, [1]);
      return `(e^(${argText(args)[0]}))`;
    }
    if (SAME_NAME_BACK.has(name)) {
      checkArity(name, args, Object.prototype.hasOwnProperty.call(SAME_NAME, name) ? SAME_NAME[name] : null);
      return `${name}(${argText(args).join(', ')})`;
    }
    throw new FormulaError(`uses ${name}(), which Canvas doesn't support`);
  };
  try {
    return { formula: write(toTree(parse(formula, { exponents: true }))).text };
  } catch (error) {
    if (error instanceof FormulaError) return { error: error.message };
    throw error;
  }
}

// ---- Canvas's calculator ------------------------------------------------------------
//
// A formula evaluated the way Canvas's Classic Quizzes calculator (calcCmd.js)
// evaluates it when an instructor generates solutions, for the export's
// self-check. Its rules: a "-" before an operand belongs to the number or name
// right after it, and only there; operators are worked out by precedence
// (^, then * /, then + -), each left to right; no implicit products; names are
// letters first, then letters, digits, "_" or "."; e and pi are constants.

const CANVAS_FUNCTIONS = {
  abs: Math.abs,
  sqrt: Math.sqrt,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  ceil: Math.ceil,
  floor: Math.floor,
  round: Math.round,
  ln: Math.log,
  log: (x, base) => Math.log(x) / Math.log(base || 10),
  max: (...args) => Math.max(...args),
  min: (...args) => Math.min(...args),
  // Canvas drops the fraction: fact(3.7) is 6.
  fact: (n) => {
    let k = Math.max(parseInt(n, 10), 0);
    if (k > 170) return Infinity;
    let product = 1;
    while (k > 1) product *= k--;
    return product;
  },
  e: (x) => Math.exp(x || 1),
  pi: () => Math.PI,
  deg_to_rad: (x) => (x * Math.PI) / 180,
  rad_to_deg: (x) => (x * 180) / Math.PI,
};
const CANVAS_CONSTANTS = { e: Math.E, pi: Math.PI };

function canvasTokens(formula) {
  const tokens = [];
  const text = String(formula);
  let i = 0;
  while (i < text.length) {
    const rest = text.slice(i);
    let match;
    if ((match = rest.match(/^\s+/))) {
      i += match[0].length;
    } else if ((match = rest.match(/^[A-Za-z][A-Za-z0-9_.]*/))) {
      tokens.push({ type: 'name', value: match[0] });
      i += match[0].length;
    } else if ((match = rest.match(/^[0-9]*\.?[0-9]+/))) {
      tokens.push({ type: 'number', value: Number(match[0]) });
      i += match[0].length;
    } else if ('+-*/^(),'.includes(text[i])) {
      tokens.push({ type: text[i] });
      i += 1;
    } else {
      throw new FormulaError(`Canvas can't read "${text[i]}"`);
    }
  }
  return tokens;
}

/**
 * The value of a Canvas formula at the given variable values, by the rules of
 * Canvas's calculator. Throws a FormulaError (with a message) where Canvas
 * reports an error.
 *
 * @param {string} formula  in Canvas's dialect
 * @param {Object<string, number>} values
 * @returns {number}
 */
function evaluateCanvasFormula(formula, values = {}) {
  const tokens = canvasTokens(formula);
  let i = 0;
  const lookup = (name) => {
    const value = Object.prototype.hasOwnProperty.call(values, name) ? Number(values[name]) : CANVAS_CONSTANTS[name];
    if (value === undefined) throw new FormulaError(`Canvas has no variable "${name}"`);
    return value;
  };
  const expression = (enders) => {
    const items = [argument()];
    while (i < tokens.length && !enders.includes(tokens[i].type)) {
      const op = tokens[i];
      if (!'+-*/^'.includes(op.type)) throw new FormulaError(`Canvas doesn't expect "${op.value ?? op.type}" here`);
      i += 1;
      items.push(op.type, argument());
    }
    // Precedence rounds, each left to right, as Canvas works them out.
    let parts = items;
    for (const ops of ['^', '*/', '+-']) {
      const next = [parts[0]];
      for (let k = 1; k < parts.length; k += 2) {
        const op = parts[k];
        const right = parts[k + 1];
        if (!ops.includes(op)) {
          next.push(op, right);
          continue;
        }
        const left = next.pop();
        if (op === '^') next.push(left ** right);
        else if (op === '*') next.push(left * right);
        else if (op === '/') next.push(left / right);
        else if (op === '+') next.push(left + right);
        else next.push(left - right);
      }
      parts = next;
    }
    return parts[0];
  };
  const argument = () => {
    const token = tokens[i];
    if (!token) throw new FormulaError('Canvas expects a value at the end');
    if (token.type === 'number') {
      i += 1;
      return token.value;
    }
    if (token.type === '-') {
      const next = tokens[i + 1];
      if (!next || (next.type !== 'number' && next.type !== 'name')) throw new FormulaError('Canvas expects a number or a name after "-"');
      if (next.type === 'name' && tokens[i + 2] && tokens[i + 2].type === '(') {
        throw new FormulaError(`Canvas can't read "-${next.value}(": a minus before a function`);
      }
      i += 2;
      return next.type === 'number' ? -next.value : -lookup(next.value);
    }
    if (token.type === 'name') {
      i += 1;
      if (!tokens[i] || tokens[i].type !== '(') return lookup(token.value);
      i += 1;
      const args = [];
      if (tokens[i] && tokens[i].type === ')') {
        i += 1;
      } else {
        for (;;) {
          args.push(expression([',', ')']));
          const end = tokens[i];
          if (!end) throw new FormulaError('Canvas expects a ")"');
          i += 1;
          if (end.type === ')') break;
        }
      }
      const fn = CANVAS_FUNCTIONS[token.value];
      if (!fn) throw new FormulaError(`Canvas has no function ${token.value}()`);
      return fn(...args);
    }
    if (token.type === '(') {
      i += 1;
      const value = expression([')']);
      if (!tokens[i]) throw new FormulaError('Canvas expects a ")"');
      i += 1;
      return value;
    }
    throw new FormulaError(`Canvas expects a value, not "${token.type}"`);
  };
  const value = expression([]);
  if (i < tokens.length) throw new FormulaError(`Canvas doesn't expect "${tokens[i].type}" here`);
  return value;
}

// ---- Placeholders ------------------------------------------------------------------

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** [x] -> {{x}} for each declared name; every other [...] is left alone. */
function canvasPlaceholdersToGrasp(text, variableNames = []) {
  let out = String(text ?? '');
  for (const name of variableNames) {
    if (!IDENT.test(name)) continue;
    out = out.split(`[${name}]`).join(`{{${name}}}`);
  }
  return out;
}

/** {{x}} (spaces allowed inside) -> [x] for each declared name. */
function graspPlaceholdersToCanvas(text, variableNames = []) {
  let out = String(text ?? '');
  for (const name of variableNames) {
    if (!IDENT.test(name)) continue;
    out = out.replace(new RegExp(`\\{\\{\\s*${escapeRegExp(name)}\\s*\\}\\}`, 'g'), `[${name}]`);
  }
  return out;
}

module.exports = {
  canvasFormulaToGrasp,
  graspFormulaToCanvas,
  evaluateCanvasFormula,
  FormulaError,
  canvasPlaceholdersToGrasp,
  graspPlaceholdersToCanvas,
  UNSUPPORTED_CANVAS_FUNCTIONS: UNSUPPORTED_CANVAS,
};
