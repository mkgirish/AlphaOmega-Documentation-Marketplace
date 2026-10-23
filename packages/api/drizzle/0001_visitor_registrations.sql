-- CMP-4 — ST-2 (AC-2, AC-3): the visitor registration the screen submits. The row holds the
-- four normalised fields and created_at as ISO 8601 UTC whole seconds, so the psql reader
-- sees exactly what the API answered. The app role may only INSERT (no id, no RETURNING);
-- the reader role may only SELECT. Roles are cluster-wide: created once without passwords
-- (the supervisor's local socket authentication decides who may log in), and their
-- attributes are reset on every database this migrates. Roles are shared by every database
-- on the cluster, so concurrent migrations queue on pg_authid rather than race on them.
LOCK TABLE pg_catalog.pg_authid IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
DO $$
BEGIN
  BEGIN
    CREATE ROLE registrations_app;
  EXCEPTION WHEN duplicate_object OR unique_violation THEN
    NULL;
  END;
  BEGIN
    CREATE ROLE registrations_reader;
  EXCEPTION WHEN duplicate_object OR unique_violation THEN
    NULL;
  END;
END
$$;
--> statement-breakpoint
ALTER ROLE registrations_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
--> statement-breakpoint
ALTER ROLE registrations_reader LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION registrations_is_utc_seconds(value text) RETURNS boolean
  LANGUAGE plpgsql IMMUTABLE STRICT SET search_path = pg_catalog
AS $$
BEGIN
  -- The trailing Z makes the cast independent of the session's TimeZone; the round trip
  -- rejects days a month does not have.
  RETURN value ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$'
    AND to_char(value::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') = value;
EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN
  RETURN false;
END
$$;
--> statement-breakpoint
ALTER TABLE registrations DROP COLUMN full_name;
--> statement-breakpoint
ALTER TABLE registrations
  ADD COLUMN first_name text NOT NULL,
  ADD COLUMN last_name  text NOT NULL,
  ADD COLUMN phone      text NOT NULL;
--> statement-breakpoint
ALTER TABLE registrations ALTER COLUMN created_at DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE registrations
  ALTER COLUMN created_at TYPE text USING to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
--> statement-breakpoint
ALTER TABLE registrations
  ALTER COLUMN created_at SET DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
--> statement-breakpoint
ALTER TABLE registrations
  ADD CONSTRAINT registrations_first_name_check
    CHECK (first_name = btrim(first_name) AND char_length(first_name) BETWEEN 1 AND 100),
  ADD CONSTRAINT registrations_last_name_check
    CHECK (last_name = btrim(last_name) AND char_length(last_name) BETWEEN 1 AND 100),
  ADD CONSTRAINT registrations_email_check
    CHECK (email = btrim(email) AND char_length(email) BETWEEN 1 AND 254),
  ADD CONSTRAINT registrations_phone_check
    CHECK (phone ~ '^[0-9]{10}$'),
  ADD CONSTRAINT registrations_created_at_check
    CHECK (registrations_is_utc_seconds(created_at));
--> statement-breakpoint
REVOKE ALL ON TABLE registrations FROM PUBLIC;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  EXECUTE format('REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC', current_database());
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO registrations_app, registrations_reader;
--> statement-breakpoint
GRANT INSERT (first_name, last_name, email, phone, created_at) ON TABLE registrations TO registrations_app;
--> statement-breakpoint
GRANT SELECT ON TABLE registrations TO registrations_reader;
--> statement-breakpoint
DO $$
BEGIN
  EXECUTE format('GRANT USAGE ON SCHEMA %I TO registrations_app, registrations_reader', current_schema());
END
$$;
