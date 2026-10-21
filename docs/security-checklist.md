# Security checklist (AD-23)

Every pull request carries this checklist (see `.github/pull_request_template.md`).
It is the per-PR record the `keyboard-pass-recorded` and `scans-pass` gates read, and
the accessibility section is where each story's manual keyboard / screen-reader pass is
recorded.

## Per-PR

- No secret, token or credential is committed. `.env` is gitignored; configuration
  comes from the environment at runtime (SQ-7).
- All inputs validated against the shared Zod rules in `packages/shared`; all responses
  use the AD-5 envelopes.
- Dependencies unchanged unless the lockfile change is intentional and reviewed. The
  lockfile is frozen for the offline builder sandboxes — no new dependencies land
  except through a reviewed lockfile update.
- Endpoints reflected in `packages/api/openapi.json` (regenerated and committed).
- Schema changes ship as committed drizzle-kit migrations under `packages/api/drizzle`.

## Image (AD-11, AD-12)

- Digest-pinned, non-root base image.
- Read-only root filesystem, `tmpfs /tmp`, `cap_drop: ALL`, `no-new-privileges`.
- Trivy scan with an SBOM; no high or critical finding.

## Accessibility (recorded per story)

For each story, record here that a manual keyboard and screen-reader pass was performed:

| Story                         | Date | Who | Result |
| ----------------------------- | ---- | --- | ------ |
| _(scaffold — no stories yet)_ |      |     |        |
