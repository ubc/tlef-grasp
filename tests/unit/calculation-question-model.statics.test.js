const CalculationQuestion = require('../../src/models/questions/CalculationQuestion');

describe('CalculationQuestion static helpers', () => {
  const originalEnv = process.env;
  const realDateNow = Date.now;

  beforeEach(() => {
    process.env = { ...originalEnv };
    jest.spyOn(Math, 'random').mockReturnValue(0.5);
    Date.now = jest.fn(() => 1_700_000_000_000);
  });

  afterEach(() => {
    Math.random.mockRestore();
    Date.now = realDateNow;
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it('normalizes syntax, placeholders, and display templates', () => {
    expect(CalculationQuestion.normalizeAsciiFormula('10 − 2 × 3 ÷ 4')).toBe(
      '10 - 2 * 3 / 4'
    );
    expect(CalculationQuestion.insertImplicitMultiplication('2(x+1)(y+2)')).toBe(
      '2*(x+1)*(y+2)'
    );
    expect(
      CalculationQuestion.canonicalizeCalculationSyntax(
        '\\left[\\frac{1}{2}\\right] + \\sqrt{x} + \\ln(E)'
      )
    ).toBe('(((1)/(2))) + sqrt(x) + log(E)');
    expect(CalculationQuestion.prepareCalculationFormula('pi + e + x', [
      { name: 'x' },
    ])).toBe('PI + E + x');
    expect(CalculationQuestion.prepareCalculationFormula('pi + e', [
      { name: 'pi' },
      { name: 'e' },
    ])).toBe('pi + e');

    expect(
      CalculationQuestion.normalizePlaceholders('Use {x} and {{var=y}} and {{z}}', [
        { name: 'x' },
        { name: 'y' },
      ])
    ).toBe('Use {{x}} and {{y}} and {{z}}');
    expect(
      CalculationQuestion.resolveCalculationDisplayTemplate(
        'No variables here',
        'Use {{x}}',
        [{ name: 'x' }]
      )
    ).toBe('Use {{x}}');
  });

  it('validates formulas and stems with precise error messages', () => {
    expect(() => CalculationQuestion.validateNoReservedVariableNames([{ name: 'E' }]))
      .toThrow('collide with built-in math constants');
    expect(() => CalculationQuestion.validateNoReservedVariableNames(null)).not.toThrow();

    expect(() =>
      CalculationQuestion.validateFormulaAgainstVariableSpecs('', [{ name: 'x' }])
    ).toThrow('calculationFormula is empty');
    expect(() =>
      CalculationQuestion.validateFormulaAgainstVariableSpecs('x + y', [{ name: 'x' }])
    ).toThrow('Formula uses variable(s) not defined in calculationVariables: y');
    expect(() =>
      CalculationQuestion.validateFormulaAgainstVariableSpecs('x + ∫', [{ name: 'x' }])
    ).toThrow('unsupported characters');
    expect(() =>
      CalculationQuestion.validateFormulaAgainstVariableSpecs('x + 1', [])
    ).toThrow('calculationVariables must define at least one valid variable name');

    expect(() =>
      CalculationQuestion.validateFormulaReferencesAllVariables('x + 1', [
        { name: 'x' },
        { name: 'y' },
      ])
    ).toThrow('Missing from formula: y');
    expect(() =>
      CalculationQuestion.validateStemReferencesAllVariables('Use {{x}}', [
        { name: 'x' },
        { name: 'y' },
      ])
    ).toThrow('Missing: y');
  });

  it('generates and renders sampled variable values deterministically', () => {
    expect(CalculationQuestion.randomIntegerInclusive(1.2, 3.8)).toBe(3);
    expect(() => CalculationQuestion.randomIntegerInclusive(5, 1)).toThrow(
      'No integer exists in range [5, 1]'
    );

    const values = CalculationQuestion.generateVariableValues([
      { name: 'x', min: 1, max: 5, integerOnly: true },
      { name: 'rate', min: 0.1, max: 0.5, decimals: 2 },
      { name: 'fixed', min: 7, max: 7, decimals: 4 },
      { name: '!!!', min: 1, max: 2 },
    ]);
    expect(values).toEqual({ x: 3, rate: 0.3, fixed: 7 });
    expect(() => CalculationQuestion.generateVariableValues([])).toThrow(
      'Calculation questions require at least one variable definition'
    );
    expect(() =>
      CalculationQuestion.generateVariableValues([{ name: 'x', min: 'bad', max: 2 }])
    ).toThrow('Invalid min/max for variable "x"');
    expect(() => CalculationQuestion.generateVariableValues([{ name: '!!!' }])).toThrow(
      'No valid variable names in calculationVariables'
    );

    expect(CalculationQuestion.formatVariableForTemplate(1.239, { decimals: 2 })).toBe(
      '1.24'
    );
    expect(
      CalculationQuestion.formatVariableForTemplate(1.6, { integerOnly: true })
    ).toBe('2');

    const rendered = CalculationQuestion.renderCalculationTemplate(
      'Given {x}, {{rate}}, and {{missing}}',
      { x: 3, rate: 0.3 },
      [
        { name: 'x', integerOnly: true },
        { name: 'rate', decimals: 2 },
      ]
    );
    expect(rendered.text).toBe('Given 3, 0.3, and ?');
    expect([...rendered.referencedVariableNames]).toEqual(['x', 'rate']);
    expect([...rendered.unknownPlaceholderNames]).toEqual(['missing']);

    expect(
      CalculationQuestion.composeStudentCalculationStem(
        { text: 'Find the value.', referencedVariableNames: new Set(['x']) },
        { x: 3, rate: 0.3 },
        [
          { name: 'x', integerOnly: true },
          { name: 'rate', decimals: 2 },
        ]
      )
    ).toBe('Find the value.\n\nGiven: rate = 0.3.');
    expect(
      CalculationQuestion.composeStudentCalculationStem(
        { text: 'Find {{oops}}.', unknownPlaceholderNames: new Set(['oops']) },
        { x: 3 },
        [{ name: 'x', integerOnly: true }]
      )
    ).toBe('Find {{oops}}.\n\nGiven: x = 3.');
  });

  it('evaluates formulas and numeric answer matching edge cases', () => {
    expect(CalculationQuestion.evaluateCalculationFormula('2*(x) + sqrt(9)', { x: 4 }))
      .toBe(11);
    expect(() =>
      CalculationQuestion.evaluateCalculationFormula('x + y', { x: 1 })
    ).toThrow('Formula needs variable(s): y');
    expect(() =>
      CalculationQuestion.evaluateCalculationFormula('x + 1', { x: 'nope' })
    ).toThrow('Variable "x" must be numeric');
    expect(() => CalculationQuestion.evaluateCalculationFormula('', {})).toThrow(
      'calculationFormula is required'
    );
    expect(() =>
      CalculationQuestion.evaluateCalculationFormula('sqrt(-1)', {})
    ).toThrow('non-finite value');

    expect(CalculationQuestion.isRetryableCalculationDrawError(
      new Error('Formula evaluation produced a non-finite value')
    )).toBe(true);
    expect(CalculationQuestion.isRetryableCalculationDrawError(new Error('no'))).toBe(
      false
    );
    expect(CalculationQuestion.roundToDecimals(1.235, 2)).toBe(1.24);
    expect(CalculationQuestion.formatAnswerForDisplay(2, 0)).toBe('2');
    expect(Number.isNaN(CalculationQuestion.parseStudentNumericAnswer(null))).toBe(true);
    expect(Number.isNaN(CalculationQuestion.parseStudentNumericAnswer('   '))).toBe(true);
    expect(CalculationQuestion.parseStudentNumericAnswer('1,234.5')).toBe(1234.5);
    expect(CalculationQuestion.numericAnswersMatch(NaN, 1, 2)).toBe(false);
    expect(CalculationQuestion.numericAnswersMatch(0.001, 0.002, 2, 10)).toBe(true);
  });

  it('signs, verifies, and rejects invalid calculation tokens', () => {
    process.env.CALCULATION_HMAC_SECRET = 'unit-secret';
    const token = CalculationQuestion.signCalculationToken('question-1', { x: 3 });

    expect(CalculationQuestion.verifyCalculationToken(token)).toEqual({
      questionId: 'question-1',
      values: { x: 3 },
      exp: 1_700_086_400_000,
    });
    expect(CalculationQuestion.verifyCalculationToken(null)).toBeNull();
    expect(CalculationQuestion.verifyCalculationToken('missing-dot')).toBeNull();
    expect(CalculationQuestion.verifyCalculationToken(`${token}bad`)).toBeNull();

    const [payload, sig] = token.split('.');
    expect(CalculationQuestion.verifyCalculationToken(`${payload}.zz`)).toBeNull();

    const expiredPayload = Buffer.from(
      JSON.stringify({ qid: 'question-1', v: { x: 3 }, exp: 1 })
    ).toString('base64url');
    const crypto = require('crypto');
    const expiredSig = crypto
      .createHmac('sha256', 'unit-secret')
      .update(expiredPayload)
      .digest('hex');
    expect(CalculationQuestion.verifyCalculationToken(`${expiredPayload}.${expiredSig}`))
      .toBeNull();

    expect(CalculationQuestion.verifyCalculationToken(`not-json.${sig}`)).toBeNull();
  });

  it('builds student calculation instances and reports validation/draw failures', () => {
    const ok = CalculationQuestion.buildStudentCalculationInstance({
      template: 'Use {x}',
      formula: 'x + 1',
      variableSpecs: [{ name: 'x', min: 1, max: 5, integerOnly: true }],
      qid: 'question-1',
      answerDec: 2,
    });

    expect(ok.ok).toBe(true);
    expect(ok.rendered).toBe('Use 3');
    expect(ok.answerDecimalPlaces).toBe(2);
    expect(CalculationQuestion.verifyCalculationToken(ok.token).values).toEqual({ x: 3 });

    expect(
      CalculationQuestion.buildStudentCalculationInstance({
        template: 'Use {x}',
        formula: '',
        variableSpecs: [{ name: 'x', min: 1, max: 5 }],
      }).error.message
    ).toBe('calculationFormula is empty');
    expect(
      CalculationQuestion.buildStudentCalculationInstance({
        template: 'Use {x}',
        formula: 'x + 1',
        variableSpecs: [],
      }).error.message
    ).toBe('calculationVariables is empty');
    expect(
      CalculationQuestion.buildStudentCalculationInstance({
        template: 'Use {x}',
        formula: 'x + y',
        variableSpecs: [{ name: 'x', min: 1, max: 5 }],
      }).error.message
    ).toContain('Formula uses variable(s) not defined');
  });

  it('tailors retry suffixes for malformed JSON, missing variables, and calculus notation', () => {
    expect(CalculationQuestion.getRetrySuffix(1, new Error('Unexpected token'))).toContain(
      'Output ONLY a valid JSON calculation question'
    );
    expect(
      CalculationQuestion.getRetrySuffix(
        1,
        new Error('calculationFormula must reference every declared variable. Missing from formula: x.')
      )
    ).toContain('OPTION A');
    expect(CalculationQuestion.getRetrySuffix(1, new Error('∫ unsupported characters')))
      .toContain('Pre-solve');
    expect(CalculationQuestion.getRetrySuffix(1, new Error('d/dx symbolic'))).toContain(
      'Pre-solve the calculus'
    );
  });
});
