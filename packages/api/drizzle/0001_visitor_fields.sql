-- CMP-4 — ST-2: the four visitor fields and a created_at that psql reads back exactly as
-- formatUtcSeconds() wrote it, plus the least-privilege roles: registrations_app may only
-- INSERT, registrations_reader may only SELECT (AD-8). The table holds no rows before ST-2.
-- Every step is guarded, so applying the file again to an existing cluster changes nothing.

ALTER TABLE registrations DROP COLUMN IF EXISTS full_name;
ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS first_name text NOT NULL,
  ADD COLUMN IF NOT EXISTS last_name  text NOT NULL,
  ADD COLUMN IF NOT EXISTS phone      text NOT NULL;
ALTER TABLE registrations ALTER COLUMN created_at DROP DEFAULT;

DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'registrations' AND column_name = 'created_at') <> 'text' THEN
    ALTER TABLE registrations
      ALTER COLUMN created_at TYPE text USING to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  END IF;
  IF NOT EXISTS (SELECT FROM pg_constraint
                 WHERE conname = 'registrations_created_at_utc_seconds'
                   AND conrelid = 'registrations'::regclass) THEN
    ALTER TABLE registrations
      ADD CONSTRAINT registrations_created_at_utc_seconds
      CHECK (created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'registrations_app') THEN
    CREATE ROLE registrations_app LOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'registrations_reader') THEN
    CREATE ROLE registrations_reader LOGIN;
  END IF;
EXCEPTION WHEN duplicate_object OR unique_violation THEN
  NULL; -- another session created them concurrently
END
$$;

DO $$
BEGIN
  EXECUTE format('GRANT USAGE ON SCHEMA %I TO registrations_app, registrations_reader', current_schema());
END
$$;

REVOKE ALL ON registrations FROM PUBLIC;
REVOKE ALL ON registrations FROM registrations_app, registrations_reader;
GRANT INSERT ON registrations TO registrations_app;
GRANT SELECT ON registrations TO registrations_reader;
