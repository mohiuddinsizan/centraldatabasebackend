-- ============================================
-- MIGRATION: add UNIT support (like tags)
-- Run this on your live DB. Safe to re-run (idempotent).
-- ============================================

BEGIN;

-- Units list (dynamic, predefined, like tags)
CREATE TABLE IF NOT EXISTS units (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) UNIQUE NOT NULL,
    created_by UUID REFERENCES admins(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Question <-> Unit (many-to-many, like question_tags)
CREATE TABLE IF NOT EXISTS question_units (
    question_id UUID REFERENCES questions(id) ON DELETE CASCADE,
    unit_id UUID REFERENCES units(id) ON DELETE CASCADE,
    PRIMARY KEY (question_id, unit_id)
);

CREATE INDEX IF NOT EXISTS idx_question_units_unit ON question_units(unit_id);

COMMIT;

-- Verify with:  \d units   and   \d question_units