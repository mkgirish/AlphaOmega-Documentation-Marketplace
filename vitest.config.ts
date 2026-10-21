import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Minimal-bootstrap root config: one node-environment run across every workspace's
// *.test.ts(x). Builders add package-level vitest.config.ts files (and jsdom for the
// web component tests) as the stories that need them land.
export default defineConfig({
  // Resolve the workspace library from its TypeScript source so tests run on a clean
  // checkout without a prior `tsc -b`. The production build/runtime still use the
  // package's dist exports; this alias only applies under vitest.
  resolve: {
    alias: {
      '@app/shared': fileURLToPath(new URL('./packages/shared/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['packages/**/src/**/*.test.{ts,tsx}'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['packages/**/src/**/*.{ts,tsx}'],
      exclude: ['packages/**/src/**/*.test.{ts,tsx}'],
    },
  },
})
