import { defineConfig } from '@playwright/test'

// DIR-7 — Gherkin-named Playwright suites, axe scans and the container job run against
// the built image (AD-19). Scaffold baseline: the harness and config; scenarios land
// with their stories. CI runs these via the playwright-follows-gherkin gate.
export default defineConfig({
  testDir: './tests',
  reporter: 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
  },
})
