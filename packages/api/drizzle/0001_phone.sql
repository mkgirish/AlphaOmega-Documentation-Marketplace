-- ST-8 — the visitor's US phone number, stored as exactly ten NANP digits (AC-1). Rows
-- written before this column existed keep an empty phone; the CHECK holds for new rows.

ALTER TABLE registrations ADD COLUMN IF NOT EXISTS phone text NOT NULL DEFAULT '';
ALTER TABLE registrations ALTER COLUMN phone DROP DEFAULT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'registrations_phone_nanp'
    AND conrelid = 'registrations'::regclass) THEN
    ALTER TABLE registrations
      ADD CONSTRAINT registrations_phone_nanp CHECK (phone ~ '^[2-9][0-9]{2}[2-9][0-9]{6}$') NOT VALID;
  END IF;
END
$$;
