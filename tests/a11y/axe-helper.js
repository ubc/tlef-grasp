// @ts-check
const AxeBuilder = require('@axe-core/playwright').default;
const { expect } = require('@playwright/test');

const BLOCKING_IMPACTS = new Set(['critical', 'serious']);

/**
 * Run a WCAG 2 A/AA axe scan and fail only on critical/serious violations.
 * Moderate/minor violations stay visible in logs so the suite can be ratcheted
 * tighter as the app is cleaned up.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ disableRules?: string[], include?: string | string[] }} [options]
 */
async function expectNoA11yViolations(page, { disableRules = [], include } = {}) {
  try {
    await page.addStyleTag({
      content: `*, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
      }`,
    });
  } catch (_) {
    // Strict CSP can block inline style injection. The base Playwright config
    // still requests reduced motion, so continue and scan the settled page.
  }

  let builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']);
  if (include) {
    builder = builder.include(include);
  }
  if (disableRules.length) {
    builder = builder.disableRules(disableRules);
  }

  const { violations } = await builder.analyze();
  const blocking = violations.filter((violation) =>
    BLOCKING_IMPACTS.has(String(violation.impact))
  );
  const nonBlocking = violations.filter(
    (violation) => !BLOCKING_IMPACTS.has(String(violation.impact))
  );

  if (nonBlocking.length) {
    // eslint-disable-next-line no-console
    console.warn(
      `[a11y] ${nonBlocking.length} non-blocking violation(s): ` +
        nonBlocking
          .map((violation) => `${violation.id} (${violation.impact})`)
          .join(', ')
    );
  }

  const detail = blocking
    .map((violation) => {
      const targets = violation.nodes
        .flatMap((node) => node.target)
        .slice(0, 5)
        .join(', ');
      return ` - ${violation.id} [${violation.impact}]: ${violation.help} (${violation.nodes.length} node(s): ${targets})`;
    })
    .join('\n');

  expect(
    blocking,
    `Blocking accessibility violations (critical/serious):\n${detail}`
  ).toEqual([]);
}

module.exports = { expectNoA11yViolations };
