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
    // No variables: the formula must be a finite constant (issue #145).
    expect(() =>
      CalculationQuestion.validateFormulaAgainstVariableSpecs('x + 1', [])
    ).toThrow('Formula uses variable(s) x but no variables are declared');
    expect(() =>
      CalculationQuestion.validateFormulaAgainstVariableSpecs('1 / 0', [])
    ).toThrow('non-finite value');
    expect(() =>
      CalculationQuestion.validateFormulaAgainstVariableSpecs('6.02e23 * 2', [])
    ).not.toThrow();
    expect(() =>
      CalculationQuestion.validateStemReferencesAllVariables('Find {{x}} and {{y}}.', [])
    ).toThrow('stem uses placeholder(s) {{x}}, {{y}} but no variables are declared');
    expect(() =>
      CalculationQuestion.validateStemReferencesAllVariables('How many moles?', [])
    ).not.toThrow();

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
    // A fixed-answer question samples nothing.
    expect(CalculationQuestion.generateVariableValues([])).toEqual({});
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
    // An expected value that is tiny but not zero is now shown in scientific
    // notation, so a percent tolerance applies to it literally: 0.001 is 50 %
    // off 0.002. Only an expected value of exactly 0 falls back to "rounds to 0".
    expect(CalculationQuestion.numericAnswersMatch(0.001, 0.002, 2, 10)).toBe(false);
    expect(CalculationQuestion.numericAnswersMatch(0.004, 0, 2, 10)).toBe(true);
    expect(CalculationQuestion.numericAnswersMatch(0.006, 0, 2, 10)).toBe(false);
  });

  // Issue #145: students write numbers many ways; anything that is not a
  // number is NaN so the route can ask again instead of grading it wrong.
  it('parses plain, thousands-separated and scientific-notation answers', () => {
    const parse = CalculationQuestion.parseStudentNumericAnswer;
    for (const text of [
      '1500',
      ' 1500 ',
      '1,500',
      '+1500',
      '1500.',
      '1.5e3',
      '1.5E3',
      '1.5e+3',
      '1.5 x 10^3',
      '1.5 X 10 ^ 3',
      '1.5×10^3',
      '1.5*10^3',
      '1.5·10^3',
      '1.5 × 10³',
      '1.5x10**3',
    ]) {
      expect(parse(text)).toBe(1500);
    }
    expect(parse('−1500')).toBe(-1500); // Unicode minus
    expect(parse('-10^3')).toBe(-1000);
    expect(parse('10^3')).toBe(1000);
    expect(parse('1.5 × 10⁻³')).toBe(0.0015);
    expect(parse('1.5e-3')).toBe(0.0015);
    expect(parse('.5')).toBe(0.5);

    for (const text of [
      'abc',
      '1500 J',
      '12abc',
      '3/4',
      '50%',
      '1.5e',
      'e3',
      '.',
      '-',
      '110^3', // not 1 × 10^3: a mantissa needs × or *
      '1.5 10^3',
      '0x10',
    ]) {
      expect(Number.isNaN(parse(text))).toBe(true);
    }
  });

  it('shows very large and very small answers in scientific notation and grades them on their digits', () => {
    const format = CalculationQuestion.formatAnswerForDisplay;
    expect(format(6.02e23, 2)).toBe('6.02 × 10^23');
    expect(format(-6.02e23, 2)).toBe('-6.02 × 10^23');
    expect(format(1.5e-7, 2)).toBe('1.5 × 10^-7');
    expect(format(0.0001, 2)).toBe('1 × 10^-4');
    expect(format(9.996e9, 2)).toBe('1 × 10^10'); // mantissa rounds up to 10
    expect(format(1e9, 2)).toBe('1 × 10^9');
    // Ordinary magnitudes are untouched.
    expect(format(1500, 2)).toBe('1500');
    expect(format(0.012, 2)).toBe('0.01');
    expect(format(0.0001, 4)).toBe('0.0001');
    expect(format(0, 2)).toBe('0');
    expect(format(144, 1)).toBe('144');

    // Exact mode compares the mantissa at the chosen decimals, not 10^23 decimal places.
    const match = CalculationQuestion.numericAnswersMatch;
    expect(match(6.02e23, 6.02e23, 2, null)).toBe(true);
    expect(match(6.021e23, 6.02e23, 2, null)).toBe(true);
    expect(match(6.0e23, 6.02e23, 2, null)).toBe(false);
    expect(match(1500.004, 1500, 2, null)).toBe(true);
    expect(match(1500.006, 1500, 2, null)).toBe(false);
  });

  it('normalizes tolerance settings and grades with each mode', () => {
    const normalize = CalculationQuestion.normalizeTolerance;
    expect(normalize(null)).toBeNull();
    expect(normalize('')).toBeNull();
    expect(normalize({ mode: 'none' })).toBeNull();
    expect(normalize(2)).toEqual({ mode: 'percent', value: 2 });
    expect(normalize('2')).toEqual({ mode: 'percent', value: 2 });
    expect(normalize(150)).toEqual({ mode: 'percent', value: 100 });
    expect(normalize({ mode: 'percent', value: '2' })).toEqual({ mode: 'percent', value: 2 });
    expect(normalize({ mode: 'absolute', value: 0.5 })).toEqual({ mode: 'absolute', value: 0.5 });
    expect(normalize({ mode: 'range', min: '10', max: '12' })).toEqual({ mode: 'range', min: 10, max: 12 });
    expect(() => normalize({ mode: 'range', min: 5, max: 1 })).toThrow('min ≤ max');
    expect(() => normalize({ mode: 'percent', value: 101 })).toThrow('0 to 100');
    expect(() => normalize({ mode: 'absolute', value: -1 })).toThrow('0 or more');
    expect(() => normalize({ mode: 'weird' })).toThrow('Unknown tolerance mode');

    // A stored question: the object wins, the legacy percent is the fallback.
    expect(CalculationQuestion.resolveTolerance({ calculationAnswerTolerancePercent: 5 }))
      .toEqual({ mode: 'percent', value: 5 });
    expect(
      CalculationQuestion.resolveTolerance({
        calculationTolerance: { mode: 'absolute', value: 0.2 },
        calculationAnswerTolerancePercent: null,
      })
    ).toEqual({ mode: 'absolute', value: 0.2 });
    expect(CalculationQuestion.resolveTolerance({ calculationTolerance: null, calculationAnswerTolerancePercent: 5 }))
      .toBeNull();
    expect(CalculationQuestion.legacyPercentOf({ mode: 'percent', value: 3 })).toBe(3);
    expect(CalculationQuestion.legacyPercentOf({ mode: 'absolute', value: 3 })).toBeNull();
    // Students learn the rule but never a range's bounds.
    expect(CalculationQuestion.toleranceForStudent({ mode: 'range', min: 10, max: 12 })).toEqual({ mode: 'range' });
    expect(CalculationQuestion.toleranceForStudent({ mode: 'percent', value: 2 })).toEqual({ mode: 'percent', value: 2 });
    expect(CalculationQuestion.toleranceForStudent(null)).toBeNull();

    const match = CalculationQuestion.numericAnswersMatch;
    expect(match(1530, 1500, 2, { mode: 'percent', value: 2 })).toBe(true);
    expect(match(1531, 1500, 2, { mode: 'percent', value: 2 })).toBe(false);
    expect(match(1530, 1500, 2, 2)).toBe(true); // legacy number still works
    expect(match(1500.2, 1500, 2, { mode: 'absolute', value: 0.2 })).toBe(true); // float noise absorbed
    expect(match(1500.3, 1500, 2, { mode: 'absolute', value: 0.2 })).toBe(false);
    expect(match(0.1 + 0.2, 0.3, 2, { mode: 'absolute', value: 0 })).toBe(true);
    expect(match(11, 0, 2, { mode: 'range', min: 10, max: 12 })).toBe(true);
    expect(match(12, 0, 2, { mode: 'range', min: 10, max: 12 })).toBe(true);
    expect(match(12.001, 0, 2, { mode: 'range', min: 10, max: 12 })).toBe(false);

    // A range needs a fixed answer.
    expect(() =>
      CalculationQuestion.validateToleranceFitsVariables({ mode: 'range', min: 1, max: 2 }, [{ name: 'x' }])
    ).toThrow('A range tolerance needs a fixed answer');
    expect(() =>
      CalculationQuestion.validateToleranceFitsVariables({ mode: 'range', min: 1, max: 2 }, [])
    ).not.toThrow();
    expect(CalculationQuestion.readGradingSettings({
      calculationAnswerDecimals: 0,
      calculationTolerance: { mode: 'range', min: 1, max: 2 },
    })).toEqual({ answerDec: 0, tolerance: { mode: 'range', min: 1, max: 2 }, tolerancePercent: null });
    // 0 decimal places is a real setting, not "unset".
    expect(CalculationQuestion.normalizeAnswerDecimals(0)).toBe(0);
    expect(CalculationQuestion.normalizeAnswerDecimals('abc')).toBe(2);
    expect(CalculationQuestion.normalizeAnswerDecimals(40)).toBe(12);
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
    ).toContain('but no variables are declared');
    expect(
      CalculationQuestion.buildStudentCalculationInstance({
        template: 'Use {x}',
        formula: 'x + y',
        variableSpecs: [{ name: 'x', min: 1, max: 5 }],
      }).error.message
    ).toContain('Formula uses variable(s) not defined');
  });

  it('builds a fixed-answer instance that every student shares', () => {
    const built = CalculationQuestion.buildStudentCalculationInstance({
      template: 'How many molecules are in two moles?',
      formula: '6.02e23 * 2',
      variableSpecs: [],
      qid: 'question-1',
      answerDec: 2,
    });
    expect(built.ok).toBe(true);
    expect(built.rendered).toBe('How many molecules are in two moles?');
    expect(CalculationQuestion.verifyCalculationToken(built.token).values).toEqual({});
    expect(
      CalculationQuestion.formatAnswerForDisplay(
        CalculationQuestion.evaluateCalculationFormula('6.02e23 * 2', {}),
        2
      )
    ).toBe('1.2 × 10^24');
    // Nothing is sampled, so there is nothing to retry: a broken constant fails at once.
    expect(
      CalculationQuestion.buildStudentCalculationInstance({
        template: 'Divide.',
        formula: '1 / 0',
        variableSpecs: [],
        qid: 'question-1',
        answerDec: 2,
      }).error.message
    ).toContain('non-finite value');
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
