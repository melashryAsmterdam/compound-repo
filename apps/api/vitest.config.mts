import { fileURLToPath } from 'node:url';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// QA-12: resolve the shared packages to their source, so tests pass on a fresh checkout without a build.
const pkg = (name: string) => fileURLToPath(new URL(`../../packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  resolve: {
    alias: {
      '@compound/domain': pkg('domain'),
      '@compound/i18n': pkg('i18n'),
      '@compound/legal': pkg('legal'),
    },
  },
  test: { testTimeout: 30_000, hookTimeout: 60_000, fileParallelism: true },
});
