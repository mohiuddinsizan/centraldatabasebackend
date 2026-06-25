-- ============================================
-- MIGRATION + SEED: add 'super_admin' role and create the super admin account
-- Safe to re-run (idempotent). Username: whitehole
-- ============================================

BEGIN;

-- 1) Allow the super_admin role
ALTER TABLE admins DROP CONSTRAINT IF EXISTS admins_role_check;
ALTER TABLE admins ADD CONSTRAINT admins_role_check
  CHECK (role IN ('super_admin', 'admin', 'uploader'));

-- 2) Seed the super admin (password is bcrypt-hashed, cost 12)
--    Plaintext password is provided separately — do NOT store it anywhere.
INSERT INTO admins (username, email, password_hash, full_name, role)
VALUES (
  'whitehole',
  'whitehole@trspbd.com',
  '$2b$12$zxWMerWBuzbkSeocluuDJOIPURm/tF04m1ymxZz49/mzFgZR0DXuu',
  'White Hole',
  'super_admin'
)
ON CONFLICT (username) DO UPDATE
  SET email         = EXCLUDED.email,
      password_hash = EXCLUDED.password_hash,
      full_name     = EXCLUDED.full_name,
      role          = 'super_admin';

COMMIT;

-- Verify:  SELECT username, email, role FROM admins WHERE username = 'whitehole';