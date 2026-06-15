import { defineConfig } from "cypress";

// These specs drive the real React app (served by `npm run dev` on :5173) and
// stub only the HTTP layer with cy.intercept. The frontend bundle, routing,
// guards, state and rendering are all exercised for real.
export default defineConfig({
  e2e: {
    baseUrl: process.env.CYPRESS_BASE_URL || "http://localhost:5173",
    specPattern: "cypress/e2e/**/*.cy.js",
    supportFile: "cypress/support/e2e.js",
    fixturesFolder: "cypress/fixtures",
    video: false,
    viewportWidth: 1280,
    viewportHeight: 800,
    // The app does its own redirects on auth failure; keep retries off so a
    // genuinely broken redirect fails loudly instead of being masked.
    retries: { runMode: 0, openMode: 0 },
  },
});
