/** @type {import('jest').Config} */
module.exports = {
  rootDir: '../..',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/e2e/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tests/e2e/tsconfig.json' }],
  },
  testTimeout: 120_000,
  // Run e2e tests serially — the devtools session is a singleton.
  maxWorkers: 1,
};
