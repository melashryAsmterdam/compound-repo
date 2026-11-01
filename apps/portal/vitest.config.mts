import { defineConfig } from 'vitest/config';
// Browser flows live in e2e/ (Playwright); vitest is for future component/unit tests.
export default defineConfig({ test: { exclude: ['e2e/**', 'node_modules/**', '.next/**'], passWithNoTests: true } });
