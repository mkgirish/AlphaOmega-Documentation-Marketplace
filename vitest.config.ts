import { defineConfig } from 'vitest/config'

// Minimal-bootstrap root config: one node-environment run across every workspace's
// *.test.ts(x). Builders add package-level vitest.config.ts files (and jsdom for the
// web component tests) as the stories that need them land.
export default defineConfig({
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
