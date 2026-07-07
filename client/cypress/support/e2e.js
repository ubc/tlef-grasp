import "./commands";

// Cypress runs with testIsolation enabled by default (Cypress 12+), so cookies,
// localStorage and sessionStorage are reset before every test automatically.
// Per-test auth/course state is seeded by the visitAs* commands below.
