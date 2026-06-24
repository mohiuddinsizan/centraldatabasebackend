-- ============================================
-- MIGRATION: add search_code + natures (and ensure units exists)
-- SAFE / NON-DESTRUCTIVE — keeps all existing questions and data.
-- Run THIS on your live DB instead of the full schema.sql rebuild.
-- Every statement is idempotent, so re-running it is harmless.
-- ============================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1) search_code on questions (optional, unique-when-present) -------------------
ALTER TABLE questions ADD COLUMN IF NOT EXISTS search_code VARCHAR(100);

CREATE UNIQUE INDEX IF NOT EXISTS idx_questions_search_code
    ON questions(search_code) WHERE search_code IS NOT NULL;

-- 2) units + question_units (in case they aren't already there) -----------------
CREATE TABLE IF NOT EXISTS units (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(200) UNIQUE NOT NULL,
    created_by UUID REFERENCES admins(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS question_units (
    question_id UUID REFERENCES questions(id) ON DELETE CASCADE,
    unit_id UUID REFERENCES units(id) ON DELETE CASCADE,
    PRIMARY KEY (question_id, unit_id)
);

CREATE INDEX IF NOT EXISTS idx_question_units_unit ON question_units(unit_id);

-- 3) natures + question_natures -------------------------------------------------
CREATE TABLE IF NOT EXISTS natures (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) UNIQUE NOT NULL,
    display_order INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS question_natures (
    question_id UUID REFERENCES questions(id) ON DELETE CASCADE,
    nature_id UUID REFERENCES natures(id) ON DELETE CASCADE,
    PRIMARY KEY (question_id, nature_id)
);

CREATE INDEX IF NOT EXISTS idx_question_natures_nature ON question_natures(nature_id);

-- Seed the four fixed natures (safe to re-run)
INSERT INTO natures (name, display_order) VALUES
('Unique', 1),
('Modified', 2),
('Brainstorming', 3),
('Previous Year Question', 4)
ON CONFLICT (name) DO NOTHING;

-- 4) OPTIONAL backfill ----------------------------------------------------------
-- The app now requires >= 1 nature on NEW uploads. Existing questions have none,
-- which is fine for display, but they'll show no nature. Uncomment to give every
-- existing question a default nature of 'Unique' so nothing looks empty.
--
-- INSERT INTO question_natures (question_id, nature_id)
-- SELECT q.id, (SELECT id FROM natures WHERE name = 'Unique')
-- FROM questions q
-- WHERE NOT EXISTS (SELECT 1 FROM question_natures qn WHERE qn.question_id = q.id);

DO $$
BEGIN
    RAISE NOTICE '✅ Migration applied: search_code + natures (+ units ensured). Existing data untouched.';
END $$;