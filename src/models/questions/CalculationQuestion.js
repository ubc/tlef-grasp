const crypto = require("crypto");
const { Parser } = require("expr-eval");
const Question = require('./Question');
const { QUESTION_TYPES } = require('../../constants/app-constants');

const _EXPR_PARSER = new Parser();

/** Names expr-eval supplies from Parser.consts (not student variables). */
const EXPR_EVAL_CONST_NAMES = new Set(Object.keys(_EXPR_PARSER.consts));

/** sin, fac, max, etc. — must not insert * before their opening parenthesis. */
const EXPR_EVAL_CALLABLE_NAMES = new Set([
  ...Object.keys(_EXPR_PARSER.functions),
  ...Object.keys(_EXPR_PARSER.unaryOps),
]);

/** Names expr-eval already supplies as math constants; declaring them as variables would override them. */
const RESERVED_VARIABLE_NAMES = new Set(["pi", "PI", "e", "E"]);

class CalculationQuestion extends Question {
    static getPromptInstruction() {
        return `### PARAMETERIZED CALCULATION QUESTION STRUCTURE:
You must output a JSON object representing a parameterized question. The server samples random values for each variable in \`calculationVariables\`, substitutes the values into the \`{{name}}\` placeholders in the \`stem\`, and evaluates \`calculationFormula\` to compute the correct answer.

### VARIABLE NAMING RULES (CRITICAL):
- Use ONLY single-letter variable names: a, b, c, d, m, n, r, t, v, x, y, z.
- Do NOT use words (e.g., "mass", "velocity", "radius", "time").
- Names in \`calculationFormula\`, \`calculationVariables\`, and \`{{name}}\` placeholders in \`stem\` must be byte-for-byte identical.

### RULES (violations cause immediate rejection):
1. **Count**: Use at most 3 variables (fewer is better).
2. **Declaration**: Only declare variables in \`calculationVariables\` that are actually used. Unused or extra declared variables will cause immediate failure.
3. **Stem Delimiters**: Every declared variable must appear in the stem wrapped in double curly braces (e.g., \`{{x}}\`). Even if you write variables in LaTeX or text (like \`s(t) = 3t\` or \`time t\`), you must still include the parameterized placeholder (e.g., \`at time t = {{t}}\` or \`when t is {{t}}\`) in the stem, so the random values can be substituted.
4. **Formula format**: \`calculationFormula\` must be ONE pure ASCII arithmetic expression (no LaTeX, no Unicode math symbols like ∫, ∑, π, or ℯ, no = sign). It must use only: \`+\`, \`-\`, \`*\`, \`/\`, \`^\`, \`(\`, \`)\`, digits, variable names, constants \`PI\` and \`E\`, and functions \`sin\`, \`cos\`, \`tan\`, \`sqrt\`, \`log\`, \`exp\`.
5. **Formula alignment**: Every variable declared in \`calculationVariables\` must be used in the formula. Conversely, every variable in the formula must be declared in \`calculationVariables\`.
6. **No Expressions in Braces**: The stem placeholders must be simple variables (e.g., \`{{x}}\`). Never put expressions inside braces (e.g., \`{{n^2}}\` or \`{{2a}}\` are invalid).
7. **Numeric Value Request**: The stem must ask for a specific numeric value. Never ask yes/no or convergence/divergence questions.
8. **Integer Preference**: Prefer \`integerOnly: true\` for variables unless decimals are required.
9. **Singularities**: Ensure min/max values never cause division by zero or square root of a negative number.
10. **Calculus Objectives**: Pre-solve the symbolic math yourself. Encode only the closed-form arithmetic result in \`calculationFormula\`. Show the original problem in the stem using LaTeX.
    - Derivative of ax^2+bx at x: formula "2*a*x + b"
    - Definite integral ∫₀ᵇ ax² dx: formula "a * b^3 / 3"
    - ODE y(t)=y₀e^(kt) at t: formula "y0 * E^(k*t)"
11. **No Limit Indices**: Do NOT use a variable to approximate a limit index (e.g., setting n to a large range to simulate n→∞). Instead, express the limit's closed-form result as the formula.
12. **Non-Trivial**: The formula must be algebraically non-trivial: every declared variable must affect the computed result (no variable cancels out, e.g., "a*(1-r)/(1-r)" is invalid).

### PROCEDURE:
1. "type": "calculation"
2. "topicTitle": short neutral label (3-10 words), no "?", must not reveal the answer.
3. "stem": question text. Every variable appears as {{name}} (double braces). Do NOT write numeric values inline — use placeholders.
4. "calculationFormula": ONE ASCII expression. References every declared variable.
5. "calculationVariables": 1-3 entries, each {"name": single letter, "min": number, "max": number, "integerOnly": true} or {"name": single letter, "min": number, "max": number, "decimals": 0-8}. Forbidden names: "pi", "PI", "e", "E".
6. "calculationAnswerDecimals": integer 0-12 (decimal places shown to the student).
7. "calculationAnswerTolerancePercent" (optional): 0-100 for percentage-band grading. Omit for exact decimal rounding.
8. "explanation": brief explanation of the formula.

### SELF-CHECK before returning JSON:
- Every name in calculationVariables appears in stem as {{name}} (double braces).
- Every {{name}} in the stem is a declared variable — no expressions inside braces.
- Every name in calculationVariables appears in calculationFormula by the exact same name.
- You have only declared variables that are actually used (no extra variables in the array).
- calculationFormula contains no LaTeX, no ∫ ∑, no = sign, no word-length names.
- The formula is non-trivial: confirm every variable affects the result (no variable cancels out).
- The stem asks for a computable number, not a convergence/divergence label.

Example (structure only — derive your own formula and variables from the course content):
{
  "type": "calculation",
  "topicTitle": "Kinetic energy of a moving object",
  "stem": "An object of mass {{m}} kg moves at {{v}} m/s. What is its kinetic energy in joules?",
  "calculationFormula": "0.5 * m * v^2",
  "calculationVariables": [
    { "name": "m", "min": 1, "max": 20, "integerOnly": true },
    { "name": "v", "min": 1, "max": 15, "integerOnly": true }
  ],
  "calculationAnswerDecimals": 1,
  "explanation": "Kinetic energy is KE = 0.5 mv², where m is mass and v is speed."
}

Do NOT include "options" or a multiple-choice "correctAnswer".`;
    }

    static getSchemaHint() {
        return `Required JSON shape for calculation:
{ "type": "calculation", "topicTitle": "short label", "stem": "Question with {{a}} and {{b}}.", "calculationFormula": "a * b", "calculationVariables": [{"name":"a","min":1,"max":10,"integerOnly":true}], "calculationAnswerDecimals": 2, "explanation": "brief" }
Rules: stem MUST use {{name}} for every variable; formula uses only + - * / ^ ( ) and variable names; every variable appears in both stem and formula.`;
    }

    static getRetrySuffix(attempt, lastError) {
        let calcExtra = "";
        if (lastError) {
            const msg = String(lastError.message || "");
            calcExtra = `\n\nYour previous attempt failed validation with the following error:\n"${msg}"\nPlease correct this error in your new response.\n\n`;
            if (/prose response|text.*instead of|refused|Expected.*property|JSON at position|Unexpected token/i.test(msg)) {
                calcExtra += "\nPrevious response was prose or malformed JSON, not a question object. Output ONLY a valid JSON calculation question — no commentary, no textbook summaries, no text outside the JSON object. ";
            }
            if (/∫|unsupported characters/i.test(msg)) {
                calcExtra +=
                    "\nThe formula contained ∫ (integral sign) which the engine cannot evaluate. You have TWO options — pick whichever gives a valid arithmetic formula:" +
                    "\n  OPTION A — Pre-solve: if the integral has a simple closed form, write it. Example: ∫₀^b ax² dx → formula \"a * b^3 / 3\"." +
                    "\n  OPTION B — Reformulate: if the integral has NO simple closed form (e.g. involves cos, sin, ln), change the question entirely. Test a simpler but related arithmetic sub-skill: evaluate the integrand at x={{x}}, compute the derivative of a term, or apply the power rule." +
                    "\nThe formula field must contain ONLY + - * / ^ ( ) sin cos sqrt log exp E PI and variable names — absolutely no ∫, no d/dt, no = sign.";
            } else if (/d\/dt|d\/dx|∑|calculus|symbolic/i.test(msg) ||
                /not defined in calculationVariables/i.test(msg) ||
                /expected variable for assignment/i.test(msg)) {
                calcExtra +=
                    "\nThe previous formula used symbolic notation which the engine cannot evaluate. " +
                    "Pre-solve the calculus: differentiate or solve the ODE analytically, then encode the closed-form result as plain ASCII arithmetic. " +
                    "Examples: derivative of ax²+bx at x → formula \"2*a*x + b\"; ODE y(t)=y₀e^(kt) → formula \"y0 * E^(k*t)\". " +
                    "If no simple closed form exists, reformulate to a simpler arithmetic sub-question instead. " +
                    "The formula field must contain only + - * / ^ ( ) and variable names — no d/dt, no ∫, no = sign.";
            }
        }

        return `For calculation — return ONLY this JSON shape (no other text):${calcExtra}
{
  "type": "calculation",
  "topicTitle": "short label based on the content",
  "stem": "Question about {{a}} and {{b}} drawn from the content.",
  "calculationFormula": "formula derived from the content (NOT a * b unless content is multiplication)",
  "calculationVariables": [
    {"name": "a", "min": 1, "max": 10, "integerOnly": true},
    {"name": "b", "min": 1, "max": 5, "decimals": 1}
  ],
  "calculationAnswerDecimals": 2,
  "explanation": "brief"
}
RULES: (1) stem MUST use {{name}} double curly braces for every variable. (2) calculationFormula uses ONLY: + - * / ^ ( ) sin cos tan sqrt log exp E PI and declared variable names — NO LaTeX, NO ∫ ∑, NO d/dt, NO = sign. (3) Every name in calculationVariables must appear in BOTH stem AND calculationFormula. (4) min/max must be numbers. No "options" field. (5) Derive the formula from the actual course content — do NOT copy the placeholder formula above.`;
    }

    static validateAndNormalize(data) {
        const merged = { ...data };
        const stemText = String(merged.stem || merged.question || "").trim();
        if (!stemText) {
            throw new Error(
                "Missing required field: stem (or question template) for calculation"
            );
        }

        let rawFormula = String(merged.calculationFormula || "").trim();
        const assignMatch = rawFormula.match(/^[A-Za-z_][A-Za-z0-9_]*\s*=(?!=)/);
        if (assignMatch) {
            rawFormula = rawFormula.slice(assignMatch[0].length).trim();
            merged.calculationFormula = rawFormula;
        }

        const formula = rawFormula;
        if (!formula) {
            throw new Error("Missing required field: calculationFormula");
        }
        const vars = merged.calculationVariables;
        if (!Array.isArray(vars) || vars.length === 0) {
            throw new Error("calculationVariables must be a non-empty array");
        }
        const normalizedVars = vars.map((v, i) => {
            if (!v || typeof v !== "object") {
                throw new Error(`calculationVariables[${i}] must be an object`);
            }
            const name = String(v.name || "")
                .trim()
                .replace(/[^a-zA-Z0-9_]/g, "");
            if (!name) {
                throw new Error(`calculationVariables[${i}] needs a valid "name"`);
            }
            const min = Number(v.min);
            const max = Number(v.max);
            if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
                throw new Error(`Invalid min/max for variable "${name}"`);
            }
            const out = { name, min, max };
            if (v.integerOnly === true) {
                out.integerOnly = true;
            } else {
                const d = parseInt(v.decimals, 10);
                out.decimals = Number.isFinite(d) ? Math.max(0, Math.min(8, d)) : 0;
            }
            return out;
        });
        let answerDec = parseInt(merged.calculationAnswerDecimals, 10);
        if (!Number.isFinite(answerDec)) answerDec = 2;
        answerDec = Math.max(0, Math.min(12, answerDec));

        const tolRaw = parseFloat(merged.calculationAnswerTolerancePercent);
        const answerTolerance = Number.isFinite(tolRaw)
            ? Math.max(0, Math.min(100, tolRaw))
            : null;
        let topicTitle = (merged.topicTitle || merged.topic || merged.shortTitle || "")
            .trim()
            .replace(/\?+$/, "");
        if (!topicTitle) {
            const before = stemText.split("{{")[0].trim();
            const words = before.split(/\s+/).filter(Boolean);
            topicTitle = words.slice(0, 10).join(" ") || "Calculation";
        }

        CalculationQuestion.validateNoReservedVariableNames(normalizedVars);
        CalculationQuestion.validateFormulaAgainstVariableSpecs(
            formula,
            normalizedVars
        );
        CalculationQuestion.validateFormulaReferencesAllVariables(
            formula,
            normalizedVars
        );
        CalculationQuestion.validateStemReferencesAllVariables(
            stemText,
            normalizedVars
        );
        const formulaCanonical =
            CalculationQuestion.prepareCalculationFormula(
                formula,
                normalizedVars
            );
        return {
            type: QUESTION_TYPES.CALCULATION,
            questionType: QUESTION_TYPES.CALCULATION,
            topicTitle,
            question: stemText,
            stem: stemText,
            calculationFormula: formulaCanonical,
            calculationVariables: normalizedVars,
            calculationAnswerDecimals: answerDec,
            calculationAnswerTolerancePercent: answerTolerance,
            explanation: merged.explanation != null ? String(merged.explanation) : "",
            options: null,
        };
    }

        static randomIntegerInclusive(min, max) {
      const lo = Math.ceil(Number(min));
      const hi = Math.floor(Number(max));
      if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo > hi) {
        throw new Error(`No integer exists in range [${min}, ${max}]`);
      }
      return Math.floor(Math.random() * (hi - lo + 1)) + lo;
    }

    /** Map common Unicode math operators to ASCII for expr-eval. */
        static normalizeAsciiFormula(formula) {
      return String(formula || "")
        .replace(/\u2212/g, "-")
        .replace(/\u2013|\u2014/g, "-")
        .replace(/\u00d7|\u22c5|\u00b7/g, "*")
        .replace(/\u00f7|\u2044|\u2215/g, "/")
        .trim();
    }

    /** Insert * for juxtaposition multiplication (e.g. 0.28(x+1) → 0.28*(x+1)) so expr-eval doesn't read it as a call. */
        static insertImplicitMultiplication(formula) {
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

    /** Strip invisibles, LaTeX fragments, and unicode math → ASCII expr-eval syntax (∑ ∫ still fail parse). */
        static canonicalizeCalculationSyntax(formula) {
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
      s = s.replace(/[\u03c0\u03a0]/g, "PI");
      s = s.replace(/\u212f/g, "E");
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

      s = CalculationQuestion.normalizeAsciiFormula(s);
      s = s.replace(/\s+/g, " ").trim();
      s = CalculationQuestion.insertImplicitMultiplication(s);
      return s;
    }

        static buildAllowedVariableNames(variableSpecs) {
      const allowed = new Set();
      for (const spec of variableSpecs || []) {
        const name = CalculationQuestion.sanitizeVariableName(spec);
        if (name) allowed.add(name);
      }
      return allowed;
    }

    /** Full normalization for storage and parsing (syntax + pi/e → PI/E when not declared as variables). */
        static prepareCalculationFormula(formula, variableSpecs) {
      const allowed = CalculationQuestion.buildAllowedVariableNames(variableSpecs);
      let f = CalculationQuestion.canonicalizeCalculationSyntax(formula);
      f = CalculationQuestion.normalizePiToBuiltin(f, allowed);
      return f.trim();
    }

    /** Rewrite bare "pi"/"e" to expr-eval's case-sensitive PI/E, unless declared as a variable. */
        static normalizePiToBuiltin(formula, allowedVariableNames) {
      const allow = allowedVariableNames instanceof Set ? allowedVariableNames : new Set(allowedVariableNames || []);
      let s = String(formula || "");
      if (!allow.has("pi") && !allow.has("PI")) {
        s = s.replace(/\bpi\b/gi, "PI");
      }
      if (!allow.has("e") && !allow.has("E")) {
        s = s.replace(/\be\b/g, "E");
      }
      return s;
    }

        static formulaParseErrorToMessage(err) {
      const m = String(err?.message || "parse error");
      if (/Unknown character/i.test(m)) {
        return new Error(
          "Formula still contains unsupported characters after normalization (e.g. ∫, ∑, or complex LaTeX). Rewrite as a plain expression using + - * / ^ ( ) and variable names; \\times/\\cdot/unicode minus are converted automatically when possible."
        );
      }
      return new Error(`Invalid formula: ${m}`);
    }

        static sanitizeVariableName(spec) {
      return String(spec?.name || "")
        .trim()
        .replace(/[^a-zA-Z0-9_]/g, "");
    }

    /** Reject variable names that collide with built-in math constants (PI, E). */
        static validateNoReservedVariableNames(variableSpecs) {
      if (!Array.isArray(variableSpecs)) return;
      const offenders = [];
      for (const spec of variableSpecs) {
        const name = CalculationQuestion.sanitizeVariableName(spec);
        if (!name) continue;
        if (RESERVED_VARIABLE_NAMES.has(name)) offenders.push(name);
      }
      if (offenders.length > 0) {
        throw new Error(
          `calculationVariables name(s) ${offenders.join(", ")} collide with built-in math constants. Use PI and E directly in calculationFormula (e.g. "PI * r^2") and do not declare them as variables.`
        );
      }
    }

    /** Reject formulas that don't reference every declared variable (catches literals baked in for sampled values). */
        static validateFormulaReferencesAllVariables(formula, variableSpecs) {
      const allowed = CalculationQuestion.buildAllowedVariableNames(variableSpecs);
      if (allowed.size === 0) return;
      const f = CalculationQuestion.prepareCalculationFormula(formula, variableSpecs);
      if (!f) return;
      let used;
      try {
        const parser = new Parser();
        used = new Set(parser.parse(f).variables());
      } catch (e) {
        throw CalculationQuestion.formulaParseErrorToMessage(e);
      }
      const missing = [...allowed].filter((n) => !used.has(n));
      if (missing.length > 0) {
        throw new Error(
          `calculationFormula must reference every declared variable. Missing from formula: ${missing.join(", ")}. Replace any hard-coded numeric literals in the formula with these variable names so the answer actually depends on the values shown in the stem.`
        );
      }
    }

    /** Names the stem references via {{name}} (after normalizing {name} and {{var=name}}), filtered to declared vars. */
        static getStemReferencedVariableNames(template, variableSpecs) {
      const allowed = CalculationQuestion.buildAllowedVariableNames(variableSpecs);
      const t = CalculationQuestion.normalizePlaceholders(template, variableSpecs);
      const found = new Set();
      const re = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;
      let m;
      while ((m = re.exec(t)) !== null) {
        const name = String(m[1]);
        if (allowed.has(name)) found.add(name);
      }
      return found;
    }

    /** Enforce that the stem references every declared variable as {{name}} using the exact declared name. */
        static validateStemReferencesAllVariables(template, variableSpecs) {
      const allowed = CalculationQuestion.buildAllowedVariableNames(variableSpecs);
      if (allowed.size === 0) return;
      const referenced = CalculationQuestion.getStemReferencedVariableNames(template, variableSpecs);
      const missing = [...allowed].filter((n) => !referenced.has(n));
      if (missing.length > 0) {
        throw new Error(
          `stem must reference each variable as {{name}} using the exact name from calculationVariables. Missing: ${missing.join(", ")}.`
        );
      }
    }

    /** Ensure every identifier used in the formula is declared in calculationVariables. */
        static validateFormulaAgainstVariableSpecs(formula, variableSpecs) {
      const allowed = CalculationQuestion.buildAllowedVariableNames(variableSpecs);
      if (allowed.size === 0) {
        throw new Error("calculationVariables must define at least one valid variable name");
      }

      const f = CalculationQuestion.prepareCalculationFormula(formula, variableSpecs);
      if (!f) {
        throw new Error("calculationFormula is empty");
      }

      let needed;
      try {
        const parser = new Parser();
        const expr = parser.parse(f);
        needed = expr.variables();
      } catch (e) {
        throw CalculationQuestion.formulaParseErrorToMessage(e);
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

    /** Build rendered stem + signed token for one student attempt; retries on rare sampling singularities. */
        static buildStudentCalculationInstance({
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
        CalculationQuestion.validateFormulaAgainstVariableSpecs(f, variableSpecs);
      } catch (e) {
        return { ok: false, error: e };
      }

      const maxDrawAttempts = 40;
      let lastError;
      for (let attempt = 0; attempt < maxDrawAttempts; attempt++) {
        try {
          const values = CalculationQuestion.generateVariableValues(variableSpecs);
          CalculationQuestion.evaluateCalculationFormula(f, values);
          const renderResult = CalculationQuestion.renderCalculationTemplate(template, values, variableSpecs);
          const rendered = CalculationQuestion.composeStudentCalculationStem(renderResult, values, variableSpecs);
          const token = CalculationQuestion.signCalculationToken(qid, values);
          return {
            ok: true,
            rendered,
            token,
            answerDecimalPlaces: answerDec,
          };
        } catch (e) {
          lastError = e;
          if (CalculationQuestion.isRetryableCalculationDrawError(e)) continue;
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

        static getHmacSecret() {
      return (
        process.env.CALCULATION_HMAC_SECRET ||
        process.env.SESSION_SECRET ||
        "tlef-grasp-calculation-dev-insecure"
      );
    }

        static generateVariableValues(variables) {
      if (!Array.isArray(variables) || variables.length === 0) {
        throw new Error("Calculation questions require at least one variable definition");
      }
      const out = {};
      for (const spec of variables) {
        const name = CalculationQuestion.sanitizeVariableName(spec);
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
          val = CalculationQuestion.randomIntegerInclusive(min, max);
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

        static formatVariableForTemplate(value, spec) {
      const integerOnly = spec && spec.integerOnly === true;
      const dec = integerOnly ? 0 : Math.max(0, Math.min(8, parseInt(spec?.decimals, 10) || 0));
      if (integerOnly) return String(Math.round(Number(value)));
      const n = Number(Number(value).toFixed(dec));
      return String(n);
    }

    /** Upgrade {var} → {{var}} for declared names, and rewrite {{var=name}} → {{name}}. */
        static normalizePlaceholders(template, variableSpecs) {
      let t = String(template || "");
      t = t.replace(
        /\{\{\s*var\s*=\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/gi,
        "{{$1}}"
      );
      for (const spec of variableSpecs || []) {
        const name = CalculationQuestion.sanitizeVariableName(spec);
        if (!name) continue;
        const hasDouble = new RegExp(`\\{\\{\\s*${name}\\s*\\}\\}`).test(t);
        if (hasDouble) continue;
        const single = new RegExp(`\\{${name}\\}`, "g");
        t = t.replace(single, `{{${name}}}`);
      }
      return t;
    }

    /** Prefer whichever of stem/title actually contains {{placeholders}}. */
        static resolveCalculationDisplayTemplate(stem, title, variableSpecs) {
      const stemT = String(stem || "").trim();
      const titleT = String(title || "").trim();
      let template = stemT || titleT;
      if (stemT && !stemT.includes("{{") && titleT.includes("{{")) {
        template = titleT;
      }
      return CalculationQuestion.normalizePlaceholders(template, variableSpecs);
    }

    /** Final student-facing stem; appends "Given:" listing for any sampled value the template doesn't show. */
        static composeStudentCalculationStem(renderResult, values, variableSpecs) {
      const baseText = String(renderResult?.text || "");
      const referenced =
        renderResult && renderResult.referencedVariableNames instanceof Set
          ? renderResult.referencedVariableNames
          : new Set();
      const unknown =
        renderResult && renderResult.unknownPlaceholderNames instanceof Set
          ? renderResult.unknownPlaceholderNames
          : new Set();

      const specByName = {};
      for (const s of variableSpecs || []) {
        const name = CalculationQuestion.sanitizeVariableName(s);
        if (name) specByName[name] = s;
      }

      const missing = [];
      for (const spec of variableSpecs || []) {
        const name = CalculationQuestion.sanitizeVariableName(spec);
        if (!name) continue;
        if (referenced.has(name)) continue;
        if (!(name in values)) continue;
        missing.push(name);
      }

      if (missing.length === 0 && unknown.size === 0) {
        return baseText;
      }

      const visibleNames =
        missing.length > 0
          ? missing
          : Object.keys(values).filter((n) => !referenced.has(n));
      if (visibleNames.length === 0) {
        return baseText;
      }

      const givenParts = visibleNames.map(
        (name) => `${name} = ${CalculationQuestion.formatVariableForTemplate(values[name], specByName[name])}`
      );
      const separator = baseText.trim().length > 0 ? "\n\n" : "";
      return `${baseText}${separator}Given: ${givenParts.join(", ")}.`;
    }

    /** Replace {{name}} with formatted values; unknown placeholders render as "?" and are reported back. */
        static renderCalculationTemplate(template, values, variableSpecs = []) {
      const specByName = {};
      for (const s of variableSpecs || []) {
        const name = CalculationQuestion.sanitizeVariableName(s);
        if (name) specByName[name] = s;
      }
      const t = CalculationQuestion.normalizePlaceholders(template, variableSpecs);
      const referencedVariableNames = new Set();
      const unknownPlaceholderNames = new Set();
      const text = String(t || "").replace(
        /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g,
        (_, name) => {
          if (name in values) {
            referencedVariableNames.add(name);
            return CalculationQuestion.formatVariableForTemplate(values[name], specByName[name]);
          }
          unknownPlaceholderNames.add(name);
          return "?";
        }
      );
      return { text, referencedVariableNames, unknownPlaceholderNames };
    }

        static evaluateCalculationFormula(formula, values) {
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
      let f = CalculationQuestion.canonicalizeCalculationSyntax(formula);
      if (!f) throw new Error("calculationFormula is required");
      f = CalculationQuestion.normalizePiToBuiltin(f, allowedFromToken);
      const parser = new Parser();
      let expr;
      try {
        expr = parser.parse(f);
      } catch (e) {
        throw CalculationQuestion.formulaParseErrorToMessage(e);
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
        static isRetryableCalculationDrawError(err) {
      return /Formula evaluation produced a non-finite value/.test(String(err?.message || ""));
    }

        static roundToDecimals(num, decimals) {
      const d = Math.max(0, Math.min(12, parseInt(decimals, 10) || 0));
      const f = 10 ** d;
      return Math.round(num * f) / f;
    }

        static formatAnswerForDisplay(num, decimals) {
      const d = Math.max(0, Math.min(12, parseInt(decimals, 10) || 0));
      const r = CalculationQuestion.roundToDecimals(num, d);
      if (d === 0) return String(Math.round(r));
      let s = r.toFixed(d);
      if (s.includes(".")) s = s.replace(/\.?0+$/, "");
      return s;
    }

        static parseStudentNumericAnswer(text) {
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
     * Compare student answer to expected value.
     * When tolerancePercent is a finite number 0–100, grades by relative error:
     *   |student − expected| / |expected| ≤ tolerancePercent / 100
     * When expected ≈ 0 (|expected| < 1e-10), falls back to absolute error with the
     * same threshold to avoid division by zero.
     * When tolerancePercent is absent/null, uses existing decimal-rounding behaviour.
     */
        static numericAnswersMatch(studentValue, expectedValue, answerDecimals, tolerancePercent) {
      if (!Number.isFinite(studentValue) || !Number.isFinite(expectedValue)) return false;

      const d = Math.max(0, Math.min(12, parseInt(answerDecimals, 10) || 0));
      const tol = Number(tolerancePercent);
      if (Number.isFinite(tol) && tol >= 0) {
        const threshold = Math.max(0, Math.min(100, tol)) / 100;
        const diff = Math.abs(studentValue - expectedValue);
        // Use absolute comparison when expected rounds to zero at the displayed precision.
        // Relative error would always be ~100% for sub-ULP values, even when both sides
        // display as "0" — e.g. formula 1/n with large n gives 0.0001 which rounds to 0.00.
        const displayZeroThreshold = 0.5 * Math.pow(10, -d);
        if (Math.abs(expectedValue) < displayZeroThreshold) {
          return diff < displayZeroThreshold;
        }
        return diff / Math.abs(expectedValue) <= threshold;
      }

      const a = CalculationQuestion.roundToDecimals(studentValue, d);
      const b = CalculationQuestion.roundToDecimals(expectedValue, d);
      const eps = Math.max(10 ** -(d + 2), 1e-12);
      return Math.abs(a - b) <= eps;
    }

        static signCalculationToken(questionId, values) {
      const exp = Date.now() + 24 * 60 * 60 * 1000;
      const payloadObj = { qid: String(questionId), v: values, exp };
      const payload = Buffer.from(JSON.stringify(payloadObj), "utf8").toString("base64url");
      const sig = crypto.createHmac("sha256", CalculationQuestion.getHmacSecret()).update(payload).digest("hex");
      return `${payload}.${sig}`;
    }

        static verifyCalculationToken(token) {
      if (!token || typeof token !== "string") return null;
      const dot = token.lastIndexOf(".");
      if (dot <= 0) return null;
      const payload = token.slice(0, dot);
      const sig = token.slice(dot + 1);
      const expectedSig = crypto.createHmac("sha256", CalculationQuestion.getHmacSecret()).update(payload).digest("hex");
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


}

module.exports = CalculationQuestion;
