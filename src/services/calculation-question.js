const crypto = require("crypto");
const { Parser } = require("expr-eval");

const _EXPR_PARSER = new Parser();

/** Names expr-eval supplies from Parser.consts (not student variables). */
const EXPR_EVAL_CONST_NAMES = new Set(Object.keys(_EXPR_PARSER.consts));

/** sin, fac, max, etc. — must not insert * before their opening parenthesis. */
const EXPR_EVAL_CALLABLE_NAMES = new Set([
  ...Object.keys(_EXPR_PARSER.functions),
  ...Object.keys(_EXPR_PARSER.unaryOps),
]);

function randomIntegerInclusive(min, max) {
  const lo = Math.ceil(Number(min));
  const hi = Math.floor(Number(max));
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo > hi) {
    throw new Error(`No integer exists in range [${min}, ${max}]`);
  }
  return Math.floor(Math.random() * (hi - lo + 1)) + lo;
}

/**
 * Map common Unicode math operators to ASCII for expr-eval.
 */
function normalizeAsciiFormula(formula) {
  return String(formula || "")
    .replace(/\u2212/g, "-")
    .replace(/\u2013|\u2014/g, "-")
    .replace(/\u00d7|\u22c5|\u00b7/g, "*")
    .replace(/\u00f7|\u2044|\u2215/g, "/")
    .trim();
}

/**
 * expr-eval parses "number(" and "ident(" as function calls. Insert * for juxtaposition multiplication
 * (e.g. 0.28(x+1) → 0.28*(x+1), (a)(b) → (a)*(b), x(y+1) → x*(y+1) when ident is not sin/sqrt/etc.).
 */
function insertImplicitMultiplication(formula) {
  let s = String(formula || "");
  for (let i = 0; i < 24; i++) {
    let next = s.replace(/\)\s*\(/g, ")*(");
    // (expr)0.28(expr2) — ")" is not in the prefix set for the rules below
    next = next.replace(
      /\)\s*(\d+\.?\d*|\.\d+)\s*\(/g,
      ")*$1*("
    );
    next = next.replace(
      /\)([A-Za-z_][A-Za-z0-9_]*)\s*\(/g,
      (full, id) =>
        EXPR_EVAL_CALLABLE_NAMES.has(id) ? full : `)*${id}*(`
    );
    next = next.replace(
      /(^|[+\-*/^,(])(\d+\.?\d*|\.\d+)\s*\(/g,
      "$1$2*("
    );
    next = next.replace(
      /(^|[+\-*/^,(])([A-Za-z_][A-Za-z0-9_]*)\s*\(/g,
      (full, pre, id) =>
        EXPR_EVAL_CALLABLE_NAMES.has(id) ? full : `${pre}${id}*(`
    );
    if (next === s) break;
    s = next;
  }
  return s;
}

/**
 * Strip invisible chars, LaTeX-style fragments, and unicode math → ASCII expr-eval syntax.
 * Does not handle true integrals (∑ ∫); those still fail parse until rewritten by the author.
 */
function canonicalizeCalculationSyntax(formula) {
  let s = String(formula || "").trim();
  if (!s) return "";

  s = s.replace(/[\u200B-\u200D\uFEFF]/g, "");

  s = s.replace(/\$/g, "");
  s = s.replace(/\\\(|\\\)|\\\[|\\\]/g, "");
  s = s.replace(/\\left\s*/gi, "");
  s = s.replace(/\\right\s*/gi, "");

  s = s.replace(/\\times/gi, "*");
  s = s.replace(/\\div/gi, "/");
  s = s.replace(/\\cdot/gi, "*");
  s = s.replace(/\\ast/gi, "*");
  s = s.replace(/\\pm\b/gi, " ");
  s = s.replace(/\\mp\b/gi, " ");

  s = s.replace(/\\pi\b/gi, "PI");
  s = s.replace(/\\sin\b/gi, "sin");
  s = s.replace(/\\cos\b/gi, "cos");
  s = s.replace(/\\tan\b/gi, "tan");
  s = s.replace(/\\ln\b/gi, "log");
  s = s.replace(/\\log10\b/gi, "log10");
  s = s.replace(/\\log\b/gi, "log");
  s = s.replace(/\\exp\b/gi, "exp");
  s = s.replace(/\\sqrt\{([^}]*)\}/gi, "sqrt($1)");

  for (let i = 0; i < 8; i++) {
    const next = s.replace(/\\frac\{([^}]*)\}\{([^}]*)\}/gi, "(($1)/($2))");
    if (next === s) break;
    s = next;
  }

  const supMap = {
    "\u2070": "^0",
    "\u00b9": "^1",
    "\u00b2": "^2",
    "\u00b3": "^3",
    "\u2074": "^4",
    "\u2075": "^5",
    "\u2076": "^6",
    "\u2077": "^7",
    "\u2078": "^8",
    "\u2079": "^9",
  };
  for (const [ch, rep] of Object.entries(supMap)) {
    s = s.split(ch).join(rep);
  }

  s = normalizeAsciiFormula(s);
  s = s.replace(/\s+/g, " ").trim();
  s = insertImplicitMultiplication(s);
  return s;
}

function buildAllowedVariableNames(variableSpecs) {
  const allowed = new Set();
  for (const spec of variableSpecs || []) {
    const name = sanitizeVariableName(spec);
    if (name) allowed.add(name);
  }
  return allowed;
}

/**
 * Full normalization for storage and parsing (syntax + pi → PI when not a variable name).
 */
function prepareCalculationFormula(formula, variableSpecs) {
  const allowed = buildAllowedVariableNames(variableSpecs);
  let f = canonicalizeCalculationSyntax(formula);
  f = normalizePiToBuiltin(f, allowed);
  return f.trim();
}

/**
 * If instructors write "pi" but mean π, map to built-in PI unless they declared a variable named pi.
 */
function normalizePiToBuiltin(formula, allowedVariableNames) {
  const allow = allowedVariableNames instanceof Set ? allowedVariableNames : new Set(allowedVariableNames || []);
  let s = String(formula || "");
  if (!allow.has("pi")) {
    s = s.replace(/\bpi\b/gi, "PI");
  }
  return s;
}

function formulaParseErrorToMessage(err) {
  const m = String(err?.message || "parse error");
  if (/Unknown character/i.test(m)) {
    return new Error(
      "Formula still contains unsupported characters after normalization (e.g. ∫, ∑, or complex LaTeX). Rewrite as a plain expression using + - * / ^ ( ) and variable names; \\times/\\cdot/unicode minus are converted automatically when possible."
    );
  }
  return new Error(`Invalid formula: ${m}`);
}

function sanitizeVariableName(spec) {
  return String(spec?.name || "")
    .trim()
    .replace(/[^a-zA-Z0-9_]/g, "");
}

/**
 * Ensure every identifier used in the formula is declared in calculationVariables.
 */
function validateFormulaAgainstVariableSpecs(formula, variableSpecs) {
  const allowed = buildAllowedVariableNames(variableSpecs);
  if (allowed.size === 0) {
    throw new Error("calculationVariables must define at least one valid variable name");
  }

  const f = prepareCalculationFormula(formula, variableSpecs);
  if (!f) {
    throw new Error("calculationFormula is empty");
  }

  let needed;
  try {
    const parser = new Parser();
    const expr = parser.parse(f);
    needed = expr.variables();
  } catch (e) {
    throw formulaParseErrorToMessage(e);
  }

  const missing = needed.filter(
    (n) => !allowed.has(n) && !EXPR_EVAL_CONST_NAMES.has(n)
  );
  if (missing.length > 0) {
    throw new Error(
      `Formula uses variable(s) not defined in calculationVariables: ${missing.join(", ")}. Add each name to the variables list or fix the formula.`
    );
  }
}

/**
 * Build rendered stem + signed token for one student attempt; retries a few times on rare sampling glitches.
 */
function buildStudentCalculationInstance({
  template,
  formula,
  variableSpecs,
  qid,
  answerDec,
}) {
  const f = String(formula || "").trim();
  if (!f) {
    return { ok: false, error: new Error("calculationFormula is empty") };
  }
  if (!Array.isArray(variableSpecs) || variableSpecs.length === 0) {
    return { ok: false, error: new Error("calculationVariables is empty") };
  }

  try {
    validateFormulaAgainstVariableSpecs(f, variableSpecs);
  } catch (e) {
    return { ok: false, error: e };
  }

  const maxDrawAttempts = 40;
  let lastError;
  for (let attempt = 0; attempt < maxDrawAttempts; attempt++) {
    try {
      const values = generateVariableValues(variableSpecs);
      evaluateCalculationFormula(f, values);
      const rendered = renderCalculationTemplate(template, values, variableSpecs);
      const token = signCalculationToken(qid, values);
      return {
        ok: true,
        rendered,
        token,
        answerDecimalPlaces: answerDec,
      };
    } catch (e) {
      lastError = e;
      if (isRetryableCalculationDrawError(e)) continue;
      return { ok: false, error: e };
    }
  }
  return {
    ok: false,
    error: new Error(
      `Could not sample calculation variables so the formula is finite (tried ${maxDrawAttempts} random draws). Tighten min/max so operations stay real and away from singularities — for example, if the answer involves 1/(x+1) or sqrt(x+1), require x > -1 (e.g. set x min to 0 or -0.5).`
    ),
  };
}

function getHmacSecret() {
  return (
    process.env.CALCULATION_HMAC_SECRET ||
    process.env.SESSION_SECRET ||
    "tlef-grasp-calculation-dev-insecure"
  );
}

/**
 * @param {Array<{ name: string, min?: number, max?: number, decimals?: number, integerOnly?: boolean }>} variables
 * @returns {Record<string, number>}
 */
function generateVariableValues(variables) {
  if (!Array.isArray(variables) || variables.length === 0) {
    throw new Error("Calculation questions require at least one variable definition");
  }
  const out = {};
  for (const spec of variables) {
    const name = sanitizeVariableName(spec);
    if (!name) continue;
    const min = Number(spec.min);
    const max = Number(spec.max);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
      throw new Error(`Invalid min/max for variable "${name}"`);
    }
    const integerOnly = spec.integerOnly === true;
    const dec = integerOnly ? 0 : Math.max(0, Math.min(8, parseInt(spec.decimals, 10) || 0));
    let val;
    if (integerOnly) {
      val = randomIntegerInclusive(min, max);
    } else if (Math.abs(max - min) < 1e-12) {
      val = min;
    } else {
      val = Math.random() * (max - min) + min;
      val = Number(val.toFixed(dec));
      val = Math.min(max, Math.max(min, val));
    }
    out[name] = val;
  }
  if (Object.keys(out).length === 0) {
    throw new Error("No valid variable names in calculationVariables");
  }
  return out;
}

function formatVariableForTemplate(value, spec) {
  const integerOnly = spec && spec.integerOnly === true;
  const dec = integerOnly ? 0 : Math.max(0, Math.min(8, parseInt(spec?.decimals, 10) || 0));
  if (integerOnly) return String(Math.round(Number(value)));
  const n = Number(Number(value).toFixed(dec));
  return String(n);
}

/**
 * Upgrade single-brace {var} to {{var}} for known variable names (LLMs sometimes omit braces).
 * Also rewrites {{var=name}} / {{ var = name }} (authoring / LLM style) to {{name}}.
 */
function normalizePlaceholders(template, variableSpecs) {
  let t = String(template || "");
  t = t.replace(
    /\{\{\s*var\s*=\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/gi,
    "{{$1}}"
  );
  for (const spec of variableSpecs || []) {
    const name = String(spec?.name || "")
      .trim()
      .replace(/[^a-zA-Z0-9_]/g, "");
    if (!name) continue;
    const hasDouble = new RegExp(`\\{\\{\\s*${name}\\s*\\}\\}`).test(t);
    if (hasDouble) continue;
    const single = new RegExp(`\\{${name}\\}`, "g");
    t = t.replace(single, `{{${name}}}`);
  }
  return t;
}

/**
 * Prefer the field that actually contains {{placeholders}} (stem vs title).
 */
function resolveCalculationDisplayTemplate(stem, title, variableSpecs) {
  const stemT = String(stem || "").trim();
  const titleT = String(title || "").trim();
  let template = stemT || titleT;
  if (stemT && !stemT.includes("{{") && titleT.includes("{{")) {
    template = titleT;
  }
  return normalizePlaceholders(template, variableSpecs);
}

/**
 * Replace {{varName}} in template with formatted values.
 * @param {string} template
 * @param {Record<string, number>} values
 * @param {Array} variableSpecs
 */
function renderCalculationTemplate(template, values, variableSpecs = []) {
  const specByName = {};
  for (const s of variableSpecs || []) {
    if (s && s.name) specByName[String(s.name).trim()] = s;
  }
  const t = normalizePlaceholders(template, variableSpecs);
  return String(t || "").replace(
    /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g,
    (_, name) => {
      if (!(name in values)) {
        throw new Error(`Template references "{{${name}}}" but variable is missing`);
      }
      return formatVariableForTemplate(values[name], specByName[name]);
    }
  );
}

/**
 * @param {string} formula
 * @param {Record<string, number>} values
 */
function evaluateCalculationFormula(formula, values) {
  const coerced = {};
  if (values && typeof values === "object") {
    for (const [k, raw] of Object.entries(values)) {
      const n = Number(raw);
      if (!Number.isFinite(n)) {
        throw new Error(`Variable "${k}" must be numeric for formula evaluation`);
      }
      coerced[k] = n;
    }
  }
  const allowedFromToken = new Set(Object.keys(coerced));
  let f = canonicalizeCalculationSyntax(formula);
  if (!f) throw new Error("calculationFormula is required");
  f = normalizePiToBuiltin(f, allowedFromToken);
  const parser = new Parser();
  let expr;
  try {
    expr = parser.parse(f);
  } catch (e) {
    throw formulaParseErrorToMessage(e);
  }
  const needed = expr.variables();
  const missing = needed.filter(
    (n) => !(n in coerced) && !EXPR_EVAL_CONST_NAMES.has(n)
  );
  if (missing.length > 0) {
    throw new Error(
      `Formula needs variable(s): ${missing.join(", ")}. Reload the quiz to get a fresh version of this question.`
    );
  }
  let result;
  try {
    result = expr.evaluate(coerced);
  } catch (e) {
    const msg = String(e?.message || "");
    if (/undefined variable/i.test(msg)) {
      const m = msg.match(/undefined variable:\s*(\w+)/i);
      const name = m ? m[1] : "?";
      throw new Error(
        `Formula references "${name}" but it is missing from this attempt's values. Reload the quiz or ask your instructor to align the formula with calculationVariables.`
      );
    }
    if (/is not a function/i.test(msg)) {
      throw new Error(
        "Formula used implicit multiplication (e.g. 0.28(x+1) without *). The engine expects 0.28*(x+1). Save the question again to normalize the formula, or ask your instructor to add explicit * between a number and '('."
      );
    }
    throw e;
  }
  const num = Number(result);
  if (!Number.isFinite(num)) {
    throw new Error(
      "Formula evaluation produced a non-finite value (NaN or Infinity). Common causes: sqrt or log of a negative number, division by zero, or a singularity inside the variable ranges (e.g. 1/(x+1) with x near -1). Narrow min/max for the variables or fix the formula."
    );
  }
  return num;
}

/** True when another random draw of variables might succeed (domain / singularity). */
function isRetryableCalculationDrawError(err) {
  return /Formula evaluation produced a non-finite value/.test(String(err?.message || ""));
}

function roundToDecimals(num, decimals) {
  const d = Math.max(0, Math.min(12, parseInt(decimals, 10) || 0));
  const f = 10 ** d;
  return Math.round(num * f) / f;
}

function formatAnswerForDisplay(num, decimals) {
  const d = Math.max(0, Math.min(12, parseInt(decimals, 10) || 0));
  const r = roundToDecimals(num, d);
  if (d === 0) return String(Math.round(r));
  let s = r.toFixed(d);
  if (s.includes(".")) s = s.replace(/\.?0+$/, "");
  return s;
}

function parseStudentNumericAnswer(text) {
  if (text === undefined || text === null) return NaN;
  const cleaned = String(text)
    .trim()
    .replace(/,/g, "")
    .replace(/\s+/g, "");
  if (cleaned === "") return NaN;
  const n = parseFloat(cleaned);
  return n;
}

/**
 * Compare student answer to expected within decimal rounding rules.
 */
function numericAnswersMatch(studentValue, expectedValue, answerDecimals) {
  const d = Math.max(0, Math.min(12, parseInt(answerDecimals, 10) || 0));
  if (!Number.isFinite(studentValue) || !Number.isFinite(expectedValue)) return false;
  const a = roundToDecimals(studentValue, d);
  const b = roundToDecimals(expectedValue, d);
  const eps = Math.max(10 ** -(d + 2), 1e-12);
  return Math.abs(a - b) <= eps;
}

function signCalculationToken(questionId, values) {
  const exp = Date.now() + 24 * 60 * 60 * 1000;
  const payloadObj = { qid: String(questionId), v: values, exp };
  const payload = Buffer.from(JSON.stringify(payloadObj), "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", getHmacSecret()).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

function verifyCalculationToken(token) {
  if (!token || typeof token !== "string") return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expectedSig = crypto.createHmac("sha256", getHmacSecret()).update(payload).digest("hex");
  try {
    const a = Buffer.from(sig, "hex");
    const b = Buffer.from(expectedSig, "hex");
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  let data;
  try {
    data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  if (typeof data.exp !== "number" || Date.now() > data.exp) return null;
  if (!data.qid || typeof data.v !== "object" || data.v === null) return null;
  return { questionId: data.qid, values: data.v, exp: data.exp };
}

module.exports = {
  generateVariableValues,
  renderCalculationTemplate,
  resolveCalculationDisplayTemplate,
  buildStudentCalculationInstance,
  validateFormulaAgainstVariableSpecs,
  prepareCalculationFormula,
  canonicalizeCalculationSyntax,
  normalizeAsciiFormula,
  evaluateCalculationFormula,
  roundToDecimals,
  formatAnswerForDisplay,
  parseStudentNumericAnswer,
  numericAnswersMatch,
  signCalculationToken,
  verifyCalculationToken,
};
