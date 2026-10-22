-- CMP-4 — ST-2: the four visitor fields IF-2 accepts, a created_at holding formatUtcSeconds()
-- text, and the least-privilege roles (AD-8): registrations_app may only INSERT and
-- registrations_reader may only SELECT. The checks repeat the API's normalisation so no
-- other writer can store a value the API would not.

ALTER TABLE registrations DROP COLUMN full_name;

ALTER TABLE registrations
  ADD COLUMN first_name text NOT NULL CONSTRAINT registrations_first_name_length CHECK (char_length(first_name) BETWEEN 1 AND 100),
  ADD COLUMN last_name text NOT NULL CONSTRAINT registrations_last_name_length CHECK (char_length(last_name) BETWEEN 1 AND 100),
  ADD COLUMN phone text NOT NULL CONSTRAINT registrations_phone_nanp CHECK (phone ~ '^[2-9][0-9]{2}[2-9][0-9]{6}$');

ALTER TABLE registrations
  ADD CONSTRAINT registrations_email_length CHECK (char_length(email) BETWEEN 3 AND 254);

ALTER TABLE registrations ALTER COLUMN created_at DROP DEFAULT;
ALTER TABLE registrations
  ALTER COLUMN created_at TYPE text USING to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
ALTER TABLE registrations
  ADD CONSTRAINT registrations_created_at_utc_seconds CHECK (created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$');

-- Roles are cluster-wide: create each once, tolerating a concurrent creator.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'registrations_app') THEN
    CREATE ROLE registrations_app LOGIN;
  END IF;
EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'registrations_reader') THEN
    CREATE ROLE registrations_reader LOGIN;
  END IF;
EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL;
END $$;

REVOKE ALL ON registrations FROM PUBLIC;
GRANT INSERT ON registrations TO registrations_app;
GRANT SELECT ON registrations TO registrations_reader;

DO $$
BEGIN
  EXECUTE format('GRANT USAGE ON SCHEMA %I TO registrations_app, registrations_reader', current_schema());
END $$;
