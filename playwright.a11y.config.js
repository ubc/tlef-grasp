// @ts-check
const { defineConfig } = require('@playwright/test');
const base = require('./playwright.config');

// Accessibility scans run separately from the E2E suite. They reuse the same
// app server, browser settings, and unauthenticated-by-default posture, but
// write their own report so artifacts never collide with regular E2E output.
module.exports = defineConfig({
  ...base,
  testDir: './tests/a11y',
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report-a11y' }],
  ],
});
