/**
 * Client-side unit tests for pure logic (no React, no DOM).
 *
 * The client is native ESM ("type": "module"), which the server's CommonJS
 * Jest config cannot parse. Rather than add Babel and its dependencies, this
 * config runs Jest's native ESM support — hence the --experimental-vm-modules
 * flag in the npm script and the empty transform.
 *
 * @type {import('jest').Config}
 */
export default {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests/client'],
  // .mjs, not .js: the root package.json has no "type", so Jest would load a
  // .js test through require() and reject the top-level await that
  // jest.unstable_mockModule needs. .mjs is unambiguously ESM.
  testMatch: ['**/*.test.mjs'],
  transform: {},
};
