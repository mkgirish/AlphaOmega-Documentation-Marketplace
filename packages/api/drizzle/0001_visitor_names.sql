-- CMP-4 — ST-10: the four visitor fields replace full_name. No row has been written before
-- this migration (no write route existed), so the NOT NULL columns need no backfill. The
-- CHECKs hold names to 1–100 characters (char_length counts code points, as the API does).

ALTER TABLE registrations DROP COLUMN full_name;

ALTER TABLE registrations
  ADD COLUMN first_name text NOT NULL CHECK (char_length(first_name) BETWEEN 1 AND 100),
  ADD COLUMN last_name  text NOT NULL CHECK (char_length(last_name) BETWEEN 1 AND 100),
  ADD COLUMN phone      text NOT NULL;
