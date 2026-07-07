/**
 * Jest config for fast, deterministic server-side unit tests.
 *
 * These tests exercise pure functions and services/routers with external
 * dependencies mocked. Browser, SAML, and accessibility coverage lives in the
 * separate Playwright layers.
 *
 * @type {import('jest').Config}
 */
module.exports = {
  testEnvironment: 'node',
  maxWorkers: 1,
  roots: ['<rootDir>/tests/unit'],
  testMatch: ['**/*.test.js'],
  clearMocks: true,
  coverageProvider: 'v8',
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/server.js',
  ],
  coverageDirectory: 'coverage-reports/unit',
  coverageReporters: ['text-summary', 'lcovonly'],
};
