// Gate: playwright-follows-gherkin (scaffold placeholder).
// Builders replace this with `npx playwright test` over the Gherkin-named
// Feature/Scenario suites in e2e/, run against the built image. The minimal scaffold
// ships the e2e/ home and playwright.config.ts but no browsers in CI, so this passes
// until the first end-to-end story lands.
import { existsSync } from 'node:fs'

const config = new URL('../../e2e/playwright.config.ts', import.meta.url)
if (!existsSync(config)) {
  console.error('playwright-follows-gherkin: e2e/playwright.config.ts is missing.')
  process.exit(1)
}
console.log('playwright-follows-gherkin: scaffold placeholder — e2e harness present; no scenarios yet. OK')
process.exit(0)
