import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 30000,
    coverage: {
      provider: 'v8',
      // NOT 'coverage': a coverage/ dir in cwd would shadow the Python
      // 'coverage' package (cwd is on sys.path) and break numba/pytest-cov.
      reportsDirectory: 'coverage-ts',
      include: ['lib/**/*.ts', 'renderers/**/*.ts', 'parsers/**/*.ts'],
      exclude: ['vitest.config.ts'],
    },
  },
});
