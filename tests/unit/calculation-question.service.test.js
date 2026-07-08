const {
  buildStudentCalculationInstance,
  canonicalizeCalculationSyntax,
  evaluateCalculationFormula,
  formatAnswerForDisplay,
  generateVariableValues,
  getStemReferencedVariableNames,
  numericAnswersMatch,
  parseStudentNumericAnswer,
  prepareCalculationFormula,
  renderCalculationTemplate,
  resolveCalculationDisplayTemplate,
  roundToDecimals,
  signCalculationToken,
  validateFormulaAgainstVariableSpecs,
  validateFormulaReferencesAllVariables,
  validateNoReservedVariableNames,
  validateStemReferencesAllVariables,
  verifyCalculationToken,
} = require('../../src/services/calculation-question');

describe('calculation question helpers', () => {
  const originalEnv = process.env;
  const realDateNow = Date.now;
  const variables = [
    { name: 'x', min: 1, max: 5, integerOnly: true },
    { name: 'rate', min: 0.1, max: 0.5, decimals: 2 },
  ];

  beforeEach(() => {
    process.env = { ...originalEnv };
    jest.spyOn(Math, 'random').mockReturnValue(0.5);
    Date.now = jest.fn(() => 1_700_000_000_000);
  });

  afterEach(() => {
    Math.random.mockRestore();
    Date.now = realDateNow;
    process.env = originalEnv;
  });

  it('canonicalizes common math syntax for expr-eval', () => {
    expect(canonicalizeCalculationSyntax('\\frac{1}{2} \\times (x + 1)')).toBe(
      '((1)/(2)) * (x + 1)'
    );
  });

  it.failing('inserts implicit multiplication between PI and adjacent variables', () => {
    // See FINDINGS.md > Unit: pi-adjacent implicit multiplication.
    expect(prepareCalculationFormula('πr²', [{ name: 'r', min: 1, max: 2 }])).toBe(
      'PI*r^2'
    );
  });

  it('evaluates formulas with implicit multiplication and unicode operators', () => {
    expect(evaluateCalculationFormula('0.5(x + 2) + π', { x: 4 })).toBeCloseTo(
      3 + Math.PI
    );
    expect(evaluateCalculationFormula('10 − 4', {})).toBe(6);
  });

  it('rejects formulas with undeclared variables and declared variables that are unused', () => {
    expect(() => validateFormulaAgainstVariableSpecs('x + y', variables)).toThrow(
      'Formula uses variable(s) not defined in calculationVariables: y'
    );
    expect(() => validateFormulaReferencesAllVariables('x + 2', variables)).toThrow(
      'Missing from formula: rate'
    );
  });

  it('rejects variable names reserved for built-in constants', () => {
    expect(() => validateNoReservedVariableNames([{ name: 'PI' }])).toThrow(
      'collide with built-in math constants'
    );
    expect(() => validateNoReservedVariableNames([{ name: 'radius' }])).not.toThrow();
  });

  it('renders templates, normalizes placeholders, and enforces stem references', () => {
    const rendered = renderCalculationTemplate(
      'Given {x} and {{var=rate}}, solve {{missing}}',
      { x: 3, rate: 0.25 },
      variables
    );

    expect(rendered.text).toBe('Given 3 and 0.25, solve ?');
    expect([...rendered.referencedVariableNames]).toEqual(['x', 'rate']);
    expect([...rendered.unknownPlaceholderNames]).toEqual(['missing']);
    expect([...getStemReferencedVariableNames('Use {x} and {{rate}}', variables)]).toEqual([
      'x',
      'rate',
    ]);
    expect(() => validateStemReferencesAllVariables('Use {{x}} only', variables)).toThrow(
      'Missing: rate'
    );
  });

  it('compares and formats numeric answers with rounding and tolerance rules', () => {
    expect(formatAnswerForDisplay(1.2301, 3)).toBe('1.23');
    expect(numericAnswersMatch(9.6, 10, 0, 5)).toBe(true);
    expect(numericAnswersMatch(9.4, 10, 0, 5)).toBe(false);
    expect(numericAnswersMatch(1.234, 1.233, 2)).toBe(true);
  });

  it('samples variables, renders missing values, and builds student instances', () => {
    expect(generateVariableValues([
      { name: 'x', min: 1, max: 5, integerOnly: true },
      { name: 'rate', min: 0.1, max: 0.5, decimals: 2 },
      { name: 'fixed', min: 7, max: 7, decimals: 3 },
      { name: '!!!', min: 1, max: 2 },
    ])).toEqual({ x: 3, rate: 0.3, fixed: 7 });

    expect(() => generateVariableValues([])).toThrow(
      'Calculation questions require at least one variable definition'
    );
    expect(() => generateVariableValues([{ name: 'x', min: 5, max: 1 }])).toThrow(
      'Invalid min/max for variable "x"'
    );
    expect(() =>
      generateVariableValues([{ name: 'x', min: 1.2, max: 1.3, integerOnly: true }])
    ).toThrow('No integer exists in range [1.2, 1.3]');
    expect(() => generateVariableValues([{ name: '!!!' }])).toThrow(
      'No valid variable names in calculationVariables'
    );

    const rendered = renderCalculationTemplate(
      'Use {x} with {{missing}}',
      { x: 3 },
      [{ name: 'x', integerOnly: true }]
    );
    expect(rendered.text).toBe('Use 3 with ?');
    expect(resolveCalculationDisplayTemplate('plain stem', 'Use {{x}}', [
      { name: 'x' },
    ])).toBe('Use {{x}}');

    const instance = buildStudentCalculationInstance({
      template: 'Use {x}',
      formula: 'x + 1',
      variableSpecs: [{ name: 'x', min: 1, max: 5, integerOnly: true }],
      qid: 'question-1',
      answerDec: 2,
    });
    expect(instance.ok).toBe(true);
    expect(instance.rendered).toBe('Use 3');
    expect(verifyCalculationToken(instance.token).values).toEqual({ x: 3 });

    expect(buildStudentCalculationInstance({ formula: '', variableSpecs: variables }).error.message)
      .toBe('calculationFormula is empty');
    expect(buildStudentCalculationInstance({ formula: 'x+1', variableSpecs: [] }).error.message)
      .toBe('calculationVariables is empty');
    expect(buildStudentCalculationInstance({
      formula: 'x + y',
      variableSpecs: [{ name: 'x', min: 1, max: 5 }],
    }).error.message).toContain('not defined');
    expect(buildStudentCalculationInstance({
      template: 'Use {x}',
      formula: 'sqrt(x)',
      variableSpecs: [{ name: 'x', min: -1, max: -1 }],
    }).error.message).toContain('Could not sample calculation variables');
  });

  it('handles evaluation, parsing, matching, and token failure branches', () => {
    expect(() => evaluateCalculationFormula('', {})).toThrow(
      'calculationFormula is required'
    );
    expect(() => evaluateCalculationFormula('x + y', { x: 1 })).toThrow(
      'Formula needs variable(s): y'
    );
    expect(() => evaluateCalculationFormula('x + 1', { x: 'nope' })).toThrow(
      'Variable "x" must be numeric'
    );
    expect(() => evaluateCalculationFormula('sqrt(-1)', {})).toThrow(
      'non-finite value'
    );
    expect(() => evaluateCalculationFormula('∫', {})).toThrow(
      'unsupported characters'
    );
    expect(() => evaluateCalculationFormula('sin x(1)', { x: 2 })).toThrow(
      'implicit multiplication'
    );

    expect(roundToDecimals(1.235, 2)).toBe(1.24);
    expect(formatAnswerForDisplay(2, 0)).toBe('2');
    expect(parseStudentNumericAnswer('1,234.5')).toBe(1234.5);
    expect(Number.isNaN(parseStudentNumericAnswer(null))).toBe(true);
    expect(Number.isNaN(parseStudentNumericAnswer('   '))).toBe(true);
    expect(numericAnswersMatch(NaN, 1, 2)).toBe(false);
    expect(numericAnswersMatch(0.001, 0.002, 2, 10)).toBe(true);

    process.env.CALCULATION_HMAC_SECRET = 'unit-secret';
    const token = signCalculationToken('question-1', { x: 3 });
    expect(verifyCalculationToken(token)).toEqual({
      questionId: 'question-1',
      values: { x: 3 },
      exp: 1_700_086_400_000,
    });
    expect(verifyCalculationToken(null)).toBeNull();
    expect(verifyCalculationToken('missing-dot')).toBeNull();
    expect(verifyCalculationToken(`${token}bad`)).toBeNull();
    expect(verifyCalculationToken('not-json.deadbeef')).toBeNull();

    const crypto = require('crypto');
    const invalidJsonPayload = Buffer.from('not json').toString('base64url');
    const invalidJsonSig = crypto
      .createHmac('sha256', 'unit-secret')
      .update(invalidJsonPayload)
      .digest('hex');
    expect(verifyCalculationToken(`${invalidJsonPayload}.${invalidJsonSig}`)).toBeNull();

    const expiredPayload = Buffer.from(
      JSON.stringify({ qid: 'question-1', v: { x: 3 }, exp: 1 })
    ).toString('base64url');
    const expiredSig = crypto
      .createHmac('sha256', 'unit-secret')
      .update(expiredPayload)
      .digest('hex');
    expect(verifyCalculationToken(`${expiredPayload}.${expiredSig}`)).toBeNull();
  });
});
