-- ============================================
-- MIGRATION: add role support to admins (admin / uploader)
-- Safe to re-run (idempotent).
-- ============================================

BEGIN;

-- Add role column; existing accounts default to 'admin'
ALTER TABLE admins ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'admin';

-- Restrict to known roles (drop-then-add makes it re-runnable)
ALTER TABLE admins DROP CONSTRAINT IF EXISTS admins_role_check;
ALTER TABLE admins ADD CONSTRAINT admins_role_check CHECK (role IN ('admin', 'uploader'));

COMMIT;

-- Verify with:  \d admins   (you should see the "role" column)