-- CMP-4 — initial migration (AD-8). Scaffold baseline: the registrations table and the
-- least-privilege app/reader grants. drizzle-kit regenerates and extends this as the
-- schema stories land; CMP-3's supervisor applies committed migrations at startup.

CREATE TABLE IF NOT EXISTS registrations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name   text NOT NULL,
  email       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
