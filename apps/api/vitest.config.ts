import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC keeps decorator metadata, which Nest's DI needs; esbuild drops it.
// Files run one at a time: each boots its own in-process Postgres.
export default defineConfig({
  plugins: [swc.vite()],
  test: { testTimeout: 30_000, hookTimeout: 60_000, fileParallelism: false },
});
