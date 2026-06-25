-- ============================================
-- MIGRATION: soft delete for questions (+ super-admin recovery)
-- Run once:  psql -h <host> -U <user> -d <db> -f database/add_soft_delete.sql
-- Safe to re-run (idempotent).
-- ============================================

BEGIN;

-- 1) Soft-delete columns
ALTER TABLE questions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES admins(id);

-- 2) Fast filtering of live vs trashed
CREATE INDEX IF NOT EXISTS idx_questions_deleted_at ON questions(deleted_at);

-- 3) Make search_code unique ONLY among live rows, so trashing a question
--    frees its code for immediate reuse.

-- 3a) Drop any existing UNIQUE CONSTRAINT on (search_code)
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'questions'::regclass
      AND con.contype = 'u'
      AND con.conkey = ARRAY[
        (SELECT attnum FROM pg_attribute
          WHERE attrelid = 'questions'::regclass AND attname = 'search_code')
      ]
  LOOP
    EXECUTE format('ALTER TABLE questions DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

-- 3b) Drop any standalone UNIQUE INDEX on (search_code), except our partial one.
--     NOTE: attname is type `name`, so cast to text before comparing to text[].
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT i.relname AS idxname
    FROM pg_index x
    JOIN pg_class i ON i.oid = x.indexrelid
    JOIN pg_class t ON t.oid = x.indrelid
    WHERE t.relname = 'questions'
      AND x.indisunique
      AND i.relname <> 'questions_search_code_live_uidx'
      AND (
        SELECT array_agg(a.attname::text ORDER BY k.ord)
        FROM unnest(x.indkey) WITH ORDINALITY AS k(attnum, ord)
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
      ) = ARRAY['search_code']::text[]
  LOOP
    EXECUTE format('DROP INDEX %I', r.idxname);
  END LOOP;
END $$;

-- 3c) Partial unique index: enforce uniqueness only for live rows that have a code
CREATE UNIQUE INDEX IF NOT EXISTS questions_search_code_live_uidx
  ON questions (search_code)
  WHERE deleted_at IS NULL AND search_code IS NOT NULL;

COMMIT;

-- Verify:  \d questions   (expect deleted_at, deleted_by, questions_search_code_live_uidx)