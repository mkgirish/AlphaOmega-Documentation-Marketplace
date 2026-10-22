-- ST-11 — the four visitor fields the screen collects (CMP-1) and the API validates (CMP-3).
-- full_name from the scaffold baseline is no longer written; it stays, nullable, so this
-- migration never drops data. Rows written before it get '' in the new columns.

ALTER TABLE registrations ADD COLUMN IF NOT EXISTS first_name text NOT NULL DEFAULT '';
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS last_name  text NOT NULL DEFAULT '';
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS phone      text NOT NULL DEFAULT '';
ALTER TABLE registrations ALTER COLUMN first_name DROP DEFAULT;
ALTER TABLE registrations ALTER COLUMN last_name  DROP DEFAULT;
ALTER TABLE registrations ALTER COLUMN phone      DROP DEFAULT;
ALTER TABLE registrations ALTER COLUMN full_name  DROP NOT NULL;
