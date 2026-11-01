import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// QA-12: resolve the shared packages to their source, so tests pass on a fresh checkout without a build.
const pkg = (name: string) => fileURLToPath(new URL(`../../packages/${name}/src/index.ts`, import.meta.url));

// Browser flows live in e2e/ (Playwright); vitest is for component/unit tests.
export default defineConfig({
  resolve: {
    alias: {
      '@compound/domain': pkg('domain'),
      '@compound/i18n': pkg('i18n'),
      '@compound/api-client': pkg('api-client'),
    },
  },
  test: { exclude: ['e2e/**', 'node_modules/**', '.next/**'], passWithNoTests: true },
});
