import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/index.ts'],
      // Repo standard: packages/domain is held to 100 % branch coverage.
      thresholds: { branches: 100, lines: 100, functions: 100, statements: 100 },
    },
  },
});
