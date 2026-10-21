-- CMP-4 — ST-8: the visitor's US phone number, stored as its ten NANP digits. No
-- registration has been stored before this story, so the column can be NOT NULL at once;
-- the CHECK repeats the API's rule so no other path can store a malformed number.

ALTER TABLE registrations
  ADD COLUMN phone text NOT NULL
  CONSTRAINT registrations_phone_nanp CHECK (phone ~ '^[2-9][0-9]{2}[2-9][0-9]{6}$');
