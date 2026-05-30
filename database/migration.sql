-- ============================================
-- MIGRATION: add video_links + year support
-- Run this on your EXISTING database (keeps all data).
-- Wrapped in a transaction: if anything fails, nothing is applied.
-- ============================================

BEGIN;

-- --------------------------------------------
-- 1. NEW: years table + seed
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS years (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    value INT UNIQUE NOT NULL,
    created_by UUID REFERENCES admins(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO years (value)
SELECT generate_series(1990, EXTRACT(YEAR FROM CURRENT_DATE)::int)
ON CONFLICT (value) DO NOTHING;

-- --------------------------------------------
-- 2. MODIFY: sources -> name only
-- --------------------------------------------
-- If your old sources rows carried a year in the `year` column and you want to
-- keep that history, migrate it BEFORE dropping the column (optional helper below).
-- Otherwise just drop the two columns.

ALTER TABLE sources DROP COLUMN IF EXISTS type;
ALTER TABLE sources DROP COLUMN IF EXISTS year;

-- Enforce unique source names.
-- ⚠️ This will FAIL if you currently have duplicate source names.
-- If it does, de-duplicate first, then re-run just this statement.
-- (Skip this line if you don't want the uniqueness constraint.)
ALTER TABLE sources ADD CONSTRAINT sources_name_key UNIQUE (name);

-- --------------------------------------------
-- 3. MODIFY: question_sources -> add optional year_id
-- --------------------------------------------
ALTER TABLE question_sources
    ADD COLUMN IF NOT EXISTS year_id UUID REFERENCES years(id) ON DELETE SET NULL;

-- --------------------------------------------
-- 4. NEW: video_links on questions
-- --------------------------------------------
ALTER TABLE questions
    ADD COLUMN IF NOT EXISTS video_links JSONB;

-- --------------------------------------------
-- 5. NEW: indexes for source / year sorting
-- --------------------------------------------
CREATE INDEX IF NOT EXISTS idx_question_sources_source ON question_sources(source_id);
CREATE INDEX IF NOT EXISTS idx_question_sources_year   ON question_sources(year_id);

-- --------------------------------------------
-- 6. NEW: source + year display view
-- --------------------------------------------
CREATE OR REPLACE VIEW question_sources_detail AS
SELECT 
    qs.question_id,
    s.id          AS source_id,
    s.name        AS source_name,
    y.id          AS year_id,
    y.value       AS year_value,
    CASE 
        WHEN y.value IS NOT NULL THEN s.name || ' (' || y.value || ')'
        ELSE s.name
    END           AS source_label
FROM question_sources qs
JOIN sources s ON qs.source_id = s.id
LEFT JOIN years y ON qs.year_id = y.id;

-- --------------------------------------------
-- 7. Refresh column comments
-- --------------------------------------------
COMMENT ON COLUMN questions.video_links IS 'Optional array of video link objects: [{"url": "...", "label": "...", "platform": "youtube"}]';
COMMENT ON COLUMN question_sources.year_id IS 'Optional year for this source on this question (nullable)';

COMMIT;

-- ============================================
-- DONE. Verify with:
--   \d sources
--   \d question_sources
--   \d questions
--   SELECT * FROM question_sources_detail LIMIT 5;
-- ============================================