// How a calculation question's numeric answer is graded (issue #145). The
// server stores `calculationTolerance` as null (exact after rounding) or
// { mode: "percent" | "absolute", value } or { mode: "range", min, max }, and
// keeps the older `calculationAnswerTolerancePercent` number in sync. Forms
// edit the four `calcTolerance*` fields below and convert on save, so the
// wizard, the edit modal and the generation page all agree on the shape.

export const CALC_TOLERANCE_MODES = [
  { value: "none", label: "Exact match (rounded to the decimal places)" },
  { value: "percent", label: "Within a percentage of the answer (± N %)" },
  { value: "absolute", label: "Within an amount of the answer (± N)" },
  { value: "range", label: "Between two values (min to max)" },
];

export const EMPTY_TOLERANCE_FORM = {
  calcToleranceMode: "none",
  calcTolerance: "",
  calcRangeMin: "",
  calcRangeMax: "",
};

/** The tolerance a stored question grades with: the object when present, else the legacy percent. */
export function resolveTolerance(question) {
  if (!question) return null;
  const stored = question.calculationTolerance;
  if (stored && typeof stored === "object" && stored.mode && stored.mode !== "none") {
    return stored;
  }
  if (stored === null) return null;
  const legacy = parseFloat(question.calculationAnswerTolerancePercent);
  return Number.isFinite(legacy) ? { mode: "percent", value: legacy } : null;
}

/** Stored question → the four form fields. */
export function toleranceToForm(question) {
  const tolerance = resolveTolerance(question);
  if (!tolerance) return { ...EMPTY_TOLERANCE_FORM };
  if (tolerance.mode === "range") {
    return {
      calcToleranceMode: "range",
      calcTolerance: "",
      calcRangeMin: String(tolerance.min ?? ""),
      calcRangeMax: String(tolerance.max ?? ""),
    };
  }
  return {
    calcToleranceMode: tolerance.mode,
    calcTolerance: String(tolerance.value ?? ""),
    calcRangeMin: "",
    calcRangeMax: "",
  };
}

/**
 * Form fields → { tolerance } or { error }. `variableCount` lets a range be
 * refused on a randomised question, where the expected value changes per
 * student and a fixed range makes no sense.
 */
export function toleranceFromForm(form, variableCount = 0) {
  const mode = form.calcToleranceMode || "none";
  if (mode === "none") return { tolerance: null };
  if (mode === "percent" || mode === "absolute") {
    const value = parseFloat(form.calcTolerance);
    if (!Number.isFinite(value) || value < 0) {
      return {
        error:
          mode === "percent"
            ? "Enter the tolerance as a percentage from 0 to 100"
            : "Enter the tolerance as a number of 0 or more",
      };
    }
    if (mode === "percent" && value > 100) {
      return { error: "A percentage tolerance cannot exceed 100" };
    }
    return { tolerance: { mode, value } };
  }
  if (mode === "range") {
    const min = parseFloat(form.calcRangeMin);
    const max = parseFloat(form.calcRangeMax);
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      return { error: "Enter both ends of the accepted range as numbers" };
    }
    if (min > max) return { error: "The range's minimum must not exceed its maximum" };
    if (variableCount > 0) {
      return {
        error:
          "A range needs a fixed answer: remove the variables, or use a percentage or amount tolerance",
      };
    }
    return { tolerance: { mode, min, max } };
  }
  return { error: `Unknown tolerance mode "${mode}"` };
}

/** The two fields to send: the object, plus the legacy percent for older readers. */
export function tolerancePayload(tolerance) {
  return {
    calculationTolerance: tolerance || null,
    calculationAnswerTolerancePercent:
      tolerance && tolerance.mode === "percent" ? tolerance.value : null,
  };
}

/** One line for summaries: "within 2% of the answer", "exact to 2 decimal places". */
export function describeTolerance(tolerance, decimals = 2) {
  if (!tolerance) {
    const d = Number.isFinite(Number(decimals)) ? Number(decimals) : 2;
    return `exact to ${d} decimal place${d === 1 ? "" : "s"}`;
  }
  if (tolerance.mode === "percent") return `within ${tolerance.value}% of the answer`;
  if (tolerance.mode === "absolute") return `within ±${tolerance.value} of the answer`;
  if (tolerance.mode === "range") return `between ${tolerance.min} and ${tolerance.max}`;
  return "";
}

/** Names used as {{placeholders}} in a stem, in order of appearance. */
export function stemPlaceholderNames(stem) {
  const names = [];
  const re = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;
  let match;
  while ((match = re.exec(String(stem || ""))) !== null) {
    if (!names.includes(match[1])) names.push(match[1]);
  }
  return names;
}
