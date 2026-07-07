const {
  canonicalizeCalculationSyntax,
  evaluateCalculationFormula,
  formatAnswerForDisplay,
  getStemReferencedVariableNames,
  numericAnswersMatch,
  prepareCalculationFormula,
  renderCalculationTemplate,
  validateFormulaAgainstVariableSpecs,
  validateFormulaReferencesAllVariables,
  validateNoReservedVariableNames,
  validateStemReferencesAllVariables,
} = require('../../src/services/calculation-question');

describe('calculation question helpers', () => {
  const variables = [
    { name: 'x', min: 1, max: 5, integerOnly: true },
    { name: 'rate', min: 0.1, max: 0.5, decimals: 2 },
  ];

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
});
