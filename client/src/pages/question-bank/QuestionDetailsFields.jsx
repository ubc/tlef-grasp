import { QUESTION_TYPES } from "../../lib/constants";
import { useToast } from "../../components/ui/Toast";
import QuestionImageField from "../../components/QuestionImageField";

const inputClass =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none";
const labelClass = "mb-1 block text-sm font-semibold text-ink";
const hintClass = "mt-1 text-xs text-muted";

const DEFAULT_VAR = { name: "", min: "1", max: "10", type: "integer" };

// Step 2 of the add-question wizard: type-specific question fields.
export default function QuestionDetailsFields({ questionType, form, setForm }) {
  const showToast = useToast();

  const set = (field) => (event) =>
    setForm((prev) => ({ ...prev, [field]: event.target.value }));

  return (
    <div className="space-y-4">
          <div>
            <label htmlFor="qdf-title" className={labelClass}>
              Question title <span className="font-normal text-muted">(short label)</span>
            </label>
            <input
              id="qdf-title"
              type="text"
              value={form.title}
              onChange={set("title")}
              placeholder="e.g. Kinetic energy formula"
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="qdf-stem" className={labelClass}>
              {questionType === QUESTION_TYPES.CALCULATION
                ? "Question template"
                : "Question stem"}
            </label>
            <textarea
              id="qdf-stem"
              rows={4}
              value={form.stem}
              onChange={set("stem")}
              placeholder={
                questionType === QUESTION_TYPES.FILL_IN_THE_BLANK
                  ? "Declarative sentence with _________ (nine underscores) for the blank"
                  : questionType === QUESTION_TYPES.CALCULATION
                    ? "e.g. An object of mass {{m}} kg moves at {{v}} m/s. What is its kinetic energy in joules?"
                    : "Enter question stem..."
              }
              className={inputClass}
            />
            {questionType === QUESTION_TYPES.FILL_IN_THE_BLANK && (
              <p className={hintClass}>
                Use exactly _________ (nine underscores) to mark the blank.
              </p>
            )}
            {questionType === QUESTION_TYPES.CALCULATION && (
              <p className={hintClass}>
                Wrap each variable name in double curly braces, e.g.{" "}
                <code>{"{{m}}"}</code>. Every variable declared below must appear here.
              </p>
            )}
            <div className="mt-2">
              <QuestionImageField
                value={form.stemImages}
                onChange={(images) => setForm((prev) => ({ ...prev, stemImages: images }))}
              />
            </div>
          </div>

          {questionType === QUESTION_TYPES.MULTIPLE_CHOICE && (
            <div>
              <label className={labelClass}>
                Options{" "}
                <span className="font-normal text-muted">
                  — select the radio button next to the correct answer
                </span>
              </label>
              <div className="space-y-3">
                {form.options.map((option, index) => (
                  <div key={option.id} className="flex items-start gap-3">
                    <label className="flex items-center gap-2 pt-2">
                      <input
                        type="radio"
                        name="wiz-correct-answer"
                        aria-label={`Mark option ${option.id} as the correct answer`}
                        checked={form.correctAnswer === option.id}
                        onChange={() =>
                          setForm((prev) => ({ ...prev, correctAnswer: option.id }))
                        }
                        className="h-4 w-4 accent-primary"
                      />
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-page text-sm font-bold text-ink">
                        {option.id}
                      </span>
                    </label>
                    <div className="flex-1 space-y-1.5">
                      <input
                        type="text"
                        aria-label={`Option ${option.id} text`}
                        value={option.text}
                        placeholder="Enter option text..."
                        onChange={(event) =>
                          setForm((prev) => {
                            const options = [...prev.options];
                            options[index] = { ...options[index], text: event.target.value };
                            return { ...prev, options };
                          })
                        }
                        className={inputClass}
                      />
                      <input
                        type="text"
                        aria-label={`Option ${option.id} feedback`}
                        value={option.feedback}
                        placeholder="Feedback shown after submission (optional)..."
                        onChange={(event) =>
                          setForm((prev) => {
                            const options = [...prev.options];
                            options[index] = {
                              ...options[index],
                              feedback: event.target.value,
                            };
                            return { ...prev, options };
                          })
                        }
                        className={`${inputClass} bg-gray-50 italic`}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {questionType === QUESTION_TYPES.FILL_IN_THE_BLANK && (
            <>
              <div>
                <label htmlFor="qdf-fib-correct" className={labelClass}>
                  Correct answer
                </label>
                <input
                  id="qdf-fib-correct"
                  type="text"
                  value={form.fibCorrect}
                  onChange={set("fibCorrect")}
                  placeholder="Canonical correct answer"
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="qdf-fib-acceptable" className={labelClass}>
                  Acceptable answers{" "}
                  <span className="font-normal text-muted">(one per line; optional)</span>
                </label>
                <textarea
                  id="qdf-fib-acceptable"
                  rows={3}
                  value={form.fibAcceptable}
                  onChange={set("fibAcceptable")}
                  placeholder="Other accepted spellings or synonyms, one per line"
                  className={inputClass}
                />
              </div>
            </>
          )}

          {questionType === QUESTION_TYPES.CALCULATION && (
            <>
              <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm">
                <div className="mb-2 font-semibold text-ink">
                  <i className="fas fa-info-circle mr-1.5 text-primary" />
                  How Calculation Questions Work
                </div>
                <p className="text-gray-600">
                  Each student receives a unique version with randomly sampled variable
                  values. The system substitutes them into the question template and
                  evaluates the answer formula automatically.
                </p>
                <div className="mt-2 space-y-1 text-xs text-gray-600">
                  <div>
                    <span className="mr-2 rounded bg-white px-1.5 py-0.5 font-semibold">Template</span>
                    An object of mass <code>{"{{m}}"}</code> kg moves at{" "}
                    <code>{"{{v}}"}</code> m/s. What is its kinetic energy in joules?
                  </div>
                  <div>
                    <span className="mr-2 rounded bg-white px-1.5 py-0.5 font-semibold">Formula</span>
                    <code>0.5 * m * v^2</code>
                  </div>
                  <div>
                    <span className="mr-2 rounded bg-white px-1.5 py-0.5 font-semibold">Student sees</span>
                    An object of mass <em>8</em> kg moves at <em>6</em> m/s… → Answer:{" "}
                    <strong>144.0</strong> J
                  </div>
                </div>
              </div>

              <div>
                <label htmlFor="qdf-calc-formula" className={labelClass}>
                  Answer formula
                </label>
                <input
                  id="qdf-calc-formula"
                  type="text"
                  value={form.calcFormula}
                  onChange={set("calcFormula")}
                  placeholder="e.g. 0.5 * m * v^2"
                  className={inputClass}
                />
                <p className={hintClass}>
                  Plain arithmetic only — operators: <code>+ - * / ^</code> | functions:{" "}
                  <code>sqrt sin cos log exp</code> | constants: <code>PI</code> (π){" "}
                  <code>E</code> (e). No LaTeX, no = sign.
                </p>
              </div>

              <div>
                <label className={labelClass}>
                  Variables{" "}
                  <span className="font-normal text-muted">
                    — up to 3; single-letter names only (a–z, except e)
                  </span>
                </label>
                <div className="space-y-2">
                  {form.calcVars.map((variable, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <div className="flex items-center gap-1 text-muted">
                        <span className="text-xs">{"{{"}</span>
                        <input
                          type="text"
                          maxLength={1}
                          value={variable.name}
                          placeholder="m"
                          title="Single lowercase letter (a–z, except e)"
                          onChange={(event) =>
                            setForm((prev) => {
                              const calcVars = [...prev.calcVars];
                              calcVars[index] = { ...calcVars[index], name: event.target.value };
                              return { ...prev, calcVars };
                            })
                          }
                          className={`${inputClass} w-12 text-center`}
                        />
                        <span className="text-xs">{"}}"}</span>
                      </div>
                      <input
                        type="number"
                        value={variable.min}
                        placeholder="1"
                        title="Minimum value (inclusive)"
                        onChange={(event) =>
                          setForm((prev) => {
                            const calcVars = [...prev.calcVars];
                            calcVars[index] = { ...calcVars[index], min: event.target.value };
                            return { ...prev, calcVars };
                          })
                        }
                        className={`${inputClass} w-20`}
                      />
                      <input
                        type="number"
                        value={variable.max}
                        placeholder="10"
                        title="Maximum value (inclusive)"
                        onChange={(event) =>
                          setForm((prev) => {
                            const calcVars = [...prev.calcVars];
                            calcVars[index] = { ...calcVars[index], max: event.target.value };
                            return { ...prev, calcVars };
                          })
                        }
                        className={`${inputClass} w-20`}
                      />
                      <select
                        aria-label={`Variable ${index + 1} value type`}
                        value={variable.type}
                        onChange={(event) =>
                          setForm((prev) => {
                            const calcVars = [...prev.calcVars];
                            calcVars[index] = { ...calcVars[index], type: event.target.value };
                            return { ...prev, calcVars };
                          })
                        }
                        className={`${inputClass} flex-1`}
                      >
                        <option value="integer">Integer</option>
                        <option value="1">1 decimal place</option>
                        <option value="2">2 decimal places</option>
                        <option value="3">3 decimal places</option>
                      </select>
                      <button
                        type="button"
                        title="Remove variable"
                        onClick={() => {
                          if (form.calcVars.length > 1) {
                            setForm((prev) => ({
                              ...prev,
                              calcVars: prev.calcVars.filter((_, i) => i !== index),
                            }));
                          } else {
                            showToast("At least one variable is required", "warning");
                          }
                        }}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-danger/10 hover:text-danger"
                      >
                        <i className="fas fa-times" />
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (form.calcVars.length >= 3) {
                      showToast("Maximum 3 variables allowed", "warning");
                      return;
                    }
                    setForm((prev) => ({
                      ...prev,
                      calcVars: [...prev.calcVars, DEFAULT_VAR],
                    }));
                  }}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-gray-50"
                >
                  <i className="fas fa-plus" /> Add Variable
                </button>
              </div>

              <div className="flex flex-wrap gap-4">
                <div className="min-w-36 flex-1">
                  <label htmlFor="qdf-calc-decimals" className={labelClass}>
                    Answer decimal places
                  </label>
                  <input
                    id="qdf-calc-decimals"
                    type="number"
                    min={0}
                    max={12}
                    value={form.calcDecimals}
                    onChange={set("calcDecimals")}
                    className={`${inputClass} max-w-32`}
                  />
                  <p className={hintClass}>
                    Decimal places shown in the correct answer (0 = integer answer).
                  </p>
                </div>
                <div className="min-w-36 flex-1">
                  <label htmlFor="qdf-calc-tolerance" className={labelClass}>
                    Tolerance % <span className="font-normal text-muted">(optional)</span>
                  </label>
                  <input
                    id="qdf-calc-tolerance"
                    type="number"
                    min={0}
                    max={100}
                    step={0.1}
                    value={form.calcTolerance}
                    onChange={set("calcTolerance")}
                    placeholder="e.g. 2"
                    className={`${inputClass} max-w-44`}
                  />
                  <p className={hintClass}>
                    Accept answers within ±N% of correct. Leave blank for exact match.
                  </p>
                </div>
              </div>
            </>
          )}

          {questionType === QUESTION_TYPES.OPEN_ENDED && (
            <>
              <div>
                <label htmlFor="qdf-open-sample" className={labelClass}>
                  Sample answer{" "}
                  <span className="font-normal text-muted">(shown after submit)</span>
                </label>
                <textarea
                  id="qdf-open-sample"
                  rows={5}
                  value={form.openSample}
                  onChange={set("openSample")}
                  placeholder="A strong example answer students see after they submit"
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="qdf-open-criteria" className={labelClass}>
                  Grading criteria{" "}
                  <span className="font-normal text-muted">(shown after submit)</span>
                </label>
                <textarea
                  id="qdf-open-criteria"
                  rows={5}
                  value={form.openCriteria}
                  onChange={set("openCriteria")}
                  placeholder="What instructors look for; bullet points or a short rubric"
                  className={inputClass}
                />
              </div>
            </>
          )}
        </div>
  );
}
