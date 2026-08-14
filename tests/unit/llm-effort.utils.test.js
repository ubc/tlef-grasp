// Reasoning effort is resolved per operation from the course's settings and the
// env, so both a course owner and a deployment can tune the quality/latency
// trade-off without a release. The built-in default is high; dialling down is
// the opt-in.

const {
  VALID_EFFORTS,
  DEFAULT_EFFORT,
  envVarForOperation,
  resolveEffort,
  effortForStage,
  resetEffortWarnings,
} = require('../../src/utils/llm-effort');

describe('envVarForOperation', () => {
  it('derives the env var from the usage-log operation label', () => {
    expect(envVarForOperation('question-generate')).toBe('LLM_EFFORT_QUESTION_GENERATE');
    expect(envVarForOperation('grade-fill-in-the-blank')).toBe(
      'LLM_EFFORT_GRADE_FILL_IN_THE_BLANK'
    );
    expect(envVarForOperation('pdf-page-image')).toBe('LLM_EFFORT_PDF_PAGE_IMAGE');
  });
});

describe('resolveEffort', () => {
  const ORIGINAL_ENV = { ...process.env };
  let warnSpy;

  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('LLM_EFFORT_') || key === 'LLM_REASONING_EFFORT') {
        delete process.env[key];
      }
    }
    resetEffortWarnings();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    process.env = { ...ORIGINAL_ENV };
  });

  it('defaults to high with no env set', () => {
    expect(resolveEffort('question-generate')).toBe('high');
    expect(resolveEffort()).toBe(DEFAULT_EFFORT);
    expect(DEFAULT_EFFORT).toBe('high');
  });

  it('applies the global override to every operation', () => {
    process.env.LLM_REASONING_EFFORT = 'high';
    expect(resolveEffort('question-generate')).toBe('high');
    expect(resolveEffort('grade-open-ended')).toBe('high');
    expect(resolveEffort()).toBe('high');
  });

  it('lets a per-operation override beat the global one', () => {
    process.env.LLM_REASONING_EFFORT = 'low';
    process.env.LLM_EFFORT_GRADE_OPEN_ENDED = 'high';

    expect(resolveEffort('grade-open-ended')).toBe('high');
    // Everything else still follows the global setting.
    expect(resolveEffort('question-generate')).toBe('low');
  });

  it('accepts every value the provider allows, case and space insensitively', () => {
    for (const effort of VALID_EFFORTS) {
      process.env.LLM_EFFORT_QUESTION_GENERATE = ` ${effort.toUpperCase()} `;
      expect(resolveEffort('question-generate')).toBe(effort);
    }
  });

  it('ignores an unrecognised value rather than sending it to the provider', () => {
    // The provider 400s on anything outside its list, so a typo in a deployment
    // env must not be able to fail every request.
    process.env.LLM_EFFORT_QUESTION_GENERATE = 'maximum';
    expect(resolveEffort('question-generate')).toBe('high');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('LLM_EFFORT_QUESTION_GENERATE'));
  });

  it('falls back to the global default when the per-operation value is invalid', () => {
    process.env.LLM_REASONING_EFFORT = 'high';
    process.env.LLM_EFFORT_QUESTION_GENERATE = 'turbo';
    expect(resolveEffort('question-generate')).toBe('high');
  });

  it('treats an empty value as unset', () => {
    process.env.LLM_EFFORT_QUESTION_GENERATE = '';
    process.env.LLM_REASONING_EFFORT = 'low';
    expect(resolveEffort('question-generate')).toBe('low');
  });

  it('warns once per bad value, not once per call', () => {
    process.env.LLM_EFFORT_QUESTION_GENERATE = 'maximum';
    resolveEffort('question-generate');
    resolveEffort('question-generate');
    resolveEffort('question-generate');
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});

describe('effortForStage', () => {
  const ORIGINAL_ENV = { ...process.env };
  let warnSpy;

  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('LLM_EFFORT_') || key === 'LLM_REASONING_EFFORT') {
        delete process.env[key];
      }
    }
    resetEffortWarnings();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    process.env = { ...ORIGINAL_ENV };
  });

  it('maps an operation to its pipeline stage', () => {
    const settings = {
      reasoningEffort: { 'question-generation': 'high', 'answer-grading': 'low' },
    };
    expect(effortForStage(settings, 'question-generate')).toBe('high');
    expect(effortForStage(settings, 'grade-open-ended')).toBe('low');
    expect(effortForStage(settings, 'grade-fill-in-the-blank')).toBe('low');
    // question-review and question-fix share the "question-review-fix" stage,
    // which this course left unset — so it takes the built-in default.
    expect(effortForStage(settings, 'question-review')).toBe('high');
  });

  it("lets the course's setting outrank both env vars", () => {
    process.env.LLM_REASONING_EFFORT = 'low';
    process.env.LLM_EFFORT_QUESTION_GENERATE = 'minimal';
    const settings = { reasoningEffort: { 'question-generation': 'high' } };

    expect(effortForStage(settings, 'question-generate')).toBe('high');
  });

  it('falls back to env for a stage the course has not set', () => {
    process.env.LLM_EFFORT_GRADE_OPEN_ENDED = 'high';
    const settings = { reasoningEffort: { 'question-generation': 'low' } };

    expect(effortForStage(settings, 'grade-open-ended')).toBe('high');
    expect(effortForStage(settings, 'outline-batch')).toBe('high');
  });

  it('ignores a stored value the provider would reject', () => {
    process.env.LLM_REASONING_EFFORT = 'high';
    const settings = { reasoningEffort: { 'question-generation': 'ludicrous' } };

    expect(effortForStage(settings, 'question-generate')).toBe('high');
  });

  it('treats absent, empty and malformed settings as unset', () => {
    expect(effortForStage(undefined, 'question-generate')).toBe('high');
    expect(effortForStage({}, 'question-generate')).toBe('high');
    expect(effortForStage({ reasoningEffort: null }, 'question-generate')).toBe('high');
    expect(effortForStage({ reasoningEffort: { 'question-generation': 5 } }, 'question-generate')).toBe('high');
  });
});
