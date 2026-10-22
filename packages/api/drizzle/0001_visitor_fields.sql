-- CMP-4 — ST-11: the screen's four fields (first name, last name, email, phone). Additive:
-- full_name stays and is written as "first last" so existing readers keep working.

ALTER TABLE registrations ADD COLUMN IF NOT EXISTS first_name text;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS last_name text;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS phone text;
