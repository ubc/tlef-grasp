const baseConfig = require('./jest.config');

/**
 * Same tests as jest.config.js, with an interactive Monocart coverage report.
 *
 * @type {import('jest').Config}
 */
module.exports = {
  ...baseConfig,
  collectCoverage: true,
  coverageProvider: 'v8',
  coverageReporters: ['none'],
  reporters: [
    'default',
    [
      'jest-monocart-coverage',
      {
        name: 'TLEF GRASP - Unit Coverage',
        outputDir: './coverage-reports/unit-monocart',
        reports: [['v8'], ['console-summary'], ['lcovonly']],
      },
    ],
  ],
};
