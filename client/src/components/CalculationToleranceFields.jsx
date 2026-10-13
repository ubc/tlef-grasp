import { CALC_TOLERANCE_MODES } from "../lib/calculationTolerance";

const HINTS = {
  none: "Students must match the answer after rounding to the decimal places above.",
  percent:
    "Accept answers within ± N % of the correct value — e.g. 2 for chemistry, 5 for engineering.",
  absolute: "Accept answers within ± N of the correct value, in the answer's own units.",
  range:
    "Accept any answer from min to max. Only for fixed answers (no variables); students are told a range applies but never see its bounds.",
};

// The "how close must a student's number be" controls shared by the add-question
// wizard and the edit modal (issue #145). Edits the four calcTolerance* fields
// described in lib/calculationTolerance.js.
export default function CalculationToleranceFields({
  form,
  setForm,
  readOnly = false,
  inputClass,
  labelClass,
  hintClass,
  idPrefix = "calc",
}) {
  const set = (field) => (event) =>
    setForm((prev) => ({ ...prev, [field]: event.target.value }));
  const mode = form.calcToleranceMode || "none";

  return (
    <div>
      <label htmlFor={`${idPrefix}-tolerance-mode`} className={labelClass}>
        Accepted answers
      </label>
      <select
        id={`${idPrefix}-tolerance-mode`}
        value={mode}
        onChange={set("calcToleranceMode")}
        disabled={readOnly}
        className={inputClass}
      >
        {CALC_TOLERANCE_MODES.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      {(mode === "percent" || mode === "absolute") && (
        <div className="mt-2 flex items-center gap-2">
          <span className="text-sm text-muted">±</span>
          <input
            id={`${idPrefix}-tolerance-value`}
            type="number"
            min={0}
            max={mode === "percent" ? 100 : undefined}
            step="any"
            aria-label={mode === "percent" ? "Tolerance in percent" : "Tolerance amount"}
            value={form.calcTolerance}
            onChange={set("calcTolerance")}
            readOnly={readOnly}
            placeholder={mode === "percent" ? "e.g. 2" : "e.g. 0.05"}
            className={`${inputClass} max-w-40`}
          />
          {mode === "percent" && <span className="text-sm text-muted">%</span>}
        </div>
      )}

      {mode === "range" && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            id={`${idPrefix}-range-min`}
            type="number"
            step="any"
            aria-label="Lowest accepted answer"
            value={form.calcRangeMin}
            onChange={set("calcRangeMin")}
            readOnly={readOnly}
            placeholder="min"
            className={`${inputClass} max-w-40`}
          />
          <span className="text-sm text-muted">to</span>
          <input
            id={`${idPrefix}-range-max`}
            type="number"
            step="any"
            aria-label="Highest accepted answer"
            value={form.calcRangeMax}
            onChange={set("calcRangeMax")}
            readOnly={readOnly}
            placeholder="max"
            className={`${inputClass} max-w-40`}
          />
        </div>
      )}

      <p className={hintClass}>{HINTS[mode] || HINTS.none}</p>
    </div>
  );
}
