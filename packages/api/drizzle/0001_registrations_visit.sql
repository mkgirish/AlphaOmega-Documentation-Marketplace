-- CMP-4 — ST-2 (AD-8): one row per submitted visit, in the shape CMP-2 normalises it to,
-- and the least-privilege roles. The scaffold table never held a row (no write route
-- existed before ST-2), so it is reshaped in place.
--
-- created_at is text holding ISO 8601 UTC whole seconds (2026-10-20T14:03:27Z): the
-- stored value is exactly what formatUtcSeconds() produces and what psql shows. The app
-- role cannot read rows back (no SELECT, no RETURNING), so the repository supplies the
-- value it answers with as a string; the default stamps UTC whatever the session time
-- zone for any insert that omits it. The CHECKs repeat CMP-2's outcome as a last line of defence; the rules
-- and their messages stay in packages/shared.
ALTER TABLE registrations DROP COLUMN IF EXISTS full_name;
--> statement-breakpoint
ALTER TABLE registrations
  ADD COLUMN first_name text NOT NULL,
  ADD COLUMN last_name  text NOT NULL,
  ADD COLUMN phone      text NOT NULL;
--> statement-breakpoint
ALTER TABLE registrations ALTER COLUMN created_at DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE registrations
  ALTER COLUMN created_at TYPE text USING to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  ALTER COLUMN created_at SET DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
--> statement-breakpoint
ALTER TABLE registrations
  ADD CONSTRAINT registrations_first_name_check
    CHECK (first_name = btrim(first_name) AND char_length(first_name) BETWEEN 1 AND 100),
  ADD CONSTRAINT registrations_last_name_check
    CHECK (last_name = btrim(last_name) AND char_length(last_name) BETWEEN 1 AND 100),
  ADD CONSTRAINT registrations_email_check
    CHECK (email = btrim(email) AND char_length(email) BETWEEN 3 AND 254),
  ADD CONSTRAINT registrations_phone_check
    CHECK (phone ~ '^[0-9]{10}$'),
  ADD CONSTRAINT registrations_created_at_check
    CHECK (
      created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$'
      AND to_char(created_at::timestamp, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') = created_at
    );
--> statement-breakpoint
-- Roles are cluster-wide: create them once, and only if absent. They log in over the
-- local socket only (no credential is stored), inherit nothing and hold no elevated attribute.
-- A concurrent migration of another database may create them first: that is not an error.
DO $$
BEGIN
  CREATE ROLE registrations_app LOGIN NOINHERIT;
EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL;
END
$$;
--> statement-breakpoint
DO $$
BEGIN
  CREATE ROLE registrations_reader LOGIN NOINHERIT;
EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL;
END
$$;
--> statement-breakpoint
ALTER ROLE registrations_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS LOGIN;
--> statement-breakpoint
ALTER ROLE registrations_reader NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS LOGIN;
--> statement-breakpoint
REVOKE ALL ON TABLE registrations FROM PUBLIC, registrations_app, registrations_reader;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO registrations_app, registrations_reader;
--> statement-breakpoint
-- The app writes one row per visit and can read nothing back; the reader only counts and reads.
GRANT INSERT ON TABLE registrations TO registrations_app;
--> statement-breakpoint
GRANT SELECT ON TABLE registrations TO registrations_reader;
