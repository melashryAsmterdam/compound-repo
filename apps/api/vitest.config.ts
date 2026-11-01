import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC keeps decorator metadata, which Nest's DI needs; esbuild drops it.
export default defineConfig({ plugins: [swc.vite()], test: { testTimeout: 30_000 } });
