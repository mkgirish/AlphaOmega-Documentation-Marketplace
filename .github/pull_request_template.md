<!-- AD-23 security checklist, carried on every PR. See docs/security-checklist.md. -->

## What changed

<!-- One or two sentences. -->

## Story / part

<!-- ST-… / PT-… this PR builds, if any. -->

## Security checklist (AD-23)

- [ ] No secret, token or credential is committed (checked against docs/security-checklist.md).
- [ ] Inputs are validated against the shared Zod rules; outputs use the AD-5 envelopes.
- [ ] New or changed endpoints are reflected in `packages/api/openapi.json` (regenerated, committed).
- [ ] Schema changes ship as a committed drizzle-kit migration.
- [ ] Dependencies unchanged, or the lockfile change is intentional and reviewed.
- [ ] Accessibility: axe-clean, and a keyboard / screen-reader pass is recorded in the story.
