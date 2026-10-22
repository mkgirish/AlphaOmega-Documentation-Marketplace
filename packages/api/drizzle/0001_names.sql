-- CMP-4 — ST-10: first and last name replace the scaffold's full_name, each held to the
-- 100-character limit (char_length counts characters, matching the API's rule), and the
-- contact fields the registration form submits. The table is empty before any story
-- writes to it, so the new columns can be NOT NULL without a default.
ALTER TABLE registrations
  DROP COLUMN full_name,
  ADD COLUMN first_name text NOT NULL,
  ADD COLUMN last_name  text NOT NULL,
  ADD COLUMN phone      text NOT NULL,
  ADD CONSTRAINT registrations_first_name_length CHECK (char_length(first_name) BETWEEN 1 AND 100),
  ADD CONSTRAINT registrations_last_name_length  CHECK (char_length(last_name)  BETWEEN 1 AND 100);
