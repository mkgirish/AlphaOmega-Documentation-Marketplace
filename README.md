# Visitor Registration Application

Monorepo for the visitor registration application. This is the **Step 10 scaffold** — the
empty, green skeleton the build (Step 11) fills in story by story.

## Layout

| Path                             | Component | What lives here                                                            |
| -------------------------------- | --------- | -------------------------------------------------------------------------- |
| `packages/web`                   | CMP-1     | React 19 + Vite + Tailwind 4 registration screen (SCR-1) and its reducer   |
| `packages/shared`                | CMP-2     | Shared registration rules: Zod schema, AD-5 envelopes, `normalise()`, etc. |
| `packages/api`                   | CMP-3     | Fastify 5 API and the committed `openapi.json`                             |
| `packages/api/drizzle`           | CMP-4     | Committed drizzle-kit PostgreSQL migrations                                |
| `packages/api/src/observability` | CMP-5     | pino logger, trace spans and the prom-client registry                      |
| `contracts`                      | —         | `contracts/IF-2.json` (OpenAPI 3.1), served by the Prism mock              |
| `e2e`                            | —         | Playwright end-to-end, axe and container tests                             |
| `docs`                           | —         | `security-checklist.md` and recorded manual accessibility passes           |
| `.github`                        | —         | `workflows/ci.yml` (the twelve required checks) and the PR template        |

## Develop

```bash
npm ci          # install from the frozen lockfile
npm test        # vitest across the workspaces
npm run lint    # eslint + prettier --check
npm run typecheck
docker compose up --build --wait registration-api shared-rules
```

## CI gates

`.github/workflows/ci.yml` runs the twelve required checks from the definition of done:
`every-criterion-tested`, `coverage-at-90`, `lint-and-types-clean`, `scans-pass`,
`trace-crosses-every-call`, `playwright-follows-gherkin`, `axe-clean`,
`keyboard-pass-recorded`, `contracts-honoured`, `openapi-regenerated`,
`migration-committed`, `image-scanned`. On the empty scaffold each passes; builders
replace the placeholder commands under `scripts/gates/` with real assertions as stories
land.
