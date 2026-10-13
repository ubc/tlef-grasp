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
 *   + - * / ^ ( )       unchanged
 *   5x, 2(x+1), (a)(b)  5*x, 2*(x+1), (a)*(b)   Canvas reads juxtaposition as a product
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
// function calls and parenthesised groups nest. Operators are not interpreted,
// so precedence is whatever the target engine does with the same characters;
// the two dialects agree on + - * / ^ and parentheses.

function tokenize(formula) {
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

function parse(formula) {
  const tokens = tokenize(formula);
  const state = { i: 0 };
  const nodes = readSequence(tokens, state);
  if (state.i < tokens.length) throw new FormulaError('a ")" with no "(" before it');
  if (nodes.length === 0) throw new FormulaError('the formula is empty');
  return nodes;
}

const OPERAND = new Set(['number', 'ident', 'group', 'call']);

// Two operands in a row ("5x", "2(x+1)", "(a)(b)") are a product in Canvas.
// Written out as "*" so expr-eval reads them the same way.
function emit(nodes, emitNode) {
  let text = '';
  nodes.forEach((node, index) => {
    if (index > 0 && OPERAND.has(node.type) && OPERAND.has(nodes[index - 1].type)) text += '*';
    text += emitNode(node);
  });
  return text;
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

/**
 * Translate a Canvas formula to a GRASP calculation formula.
 *
 * @param {string} formula  as written in the export (one line)
 * @param {string[]} variableNames  the question's declared variable names
 * @returns {{ formula: string } | { error: string }}  the error is a sentence
 *   fragment ("uses rand(), which GRASP doesn't support") for a skip reason
 */
function canvasFormulaToGrasp(formula, variableNames = []) {
  const declared = new Set(variableNames);
  const emitNode = (node) => {
    switch (node.type) {
      case 'number':
        return node.value;
      case 'op':
        return node.value;
      case 'ident':
        if (declared.has(node.value)) return node.value;
        if (node.value === 'e') return 'E';
        if (node.value === 'pi') return 'PI';
        throw new FormulaError(`uses "${node.value}", which isn't one of the question's variables`);
      case 'group':
        return `(${emit(node.inner, emitNode)})`;
      case 'call':
        return emitCall(node);
      default:
        throw new FormulaError('an unexpected token');
    }
  };
  const argText = (args) => args.map((arg) => emit(arg, emitNode));
  const emitCall = ({ name, args }) => {
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
    return { formula: emit(parse(formula), emitNode) };
  } catch (error) {
    if (error instanceof FormulaError) return { error: error.message };
    throw error;
  }
}

// ---- GRASP -> Canvas ---------------------------------------------------------------

/**
 * Translate a GRASP calculation formula to Canvas's dialect, for export.
 * Returns an error naming what Canvas cannot do (hyperbolic functions, roundTo,
 * trunc, sign, cbrt, %, ...).
 *
 * @param {string} formula  a stored GRASP formula (already canonical)
 * @param {string[]} variableNames
 * @returns {{ formula: string } | { error: string }}
 */
function graspFormulaToCanvas(formula, variableNames = []) {
  const declared = new Set(variableNames);
  const emitNode = (node) => {
    switch (node.type) {
      case 'number':
      case 'op':
        return node.value;
      case 'ident':
        if (declared.has(node.value)) return node.value;
        if (node.value === 'E' || node.value === 'e') return 'e';
        if (node.value === 'PI' || node.value === 'pi') return 'pi';
        throw new FormulaError(`uses "${node.value}", which isn't one of the question's variables`);
      case 'group':
        return `(${emit(node.inner, emitNode)})`;
      case 'call':
        return emitCall(node);
      default:
        throw new FormulaError('an unexpected token');
    }
  };
  const argText = (args) => args.map((arg) => emit(arg, emitNode));
  const emitCall = ({ name, args }) => {
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
    return { formula: emit(parse(formula), emitNode) };
  } catch (error) {
    if (error instanceof FormulaError) return { error: error.message };
    throw error;
  }
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
  canvasPlaceholdersToGrasp,
  graspPlaceholdersToCanvas,
  UNSUPPORTED_CANVAS_FUNCTIONS: UNSUPPORTED_CANVAS,
};
