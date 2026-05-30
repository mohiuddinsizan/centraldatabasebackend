-- ============================================
-- QUESTION BANK DATABASE SCHEMA
-- Complete schema with image + VIDEO LINK + YEAR support
-- ============================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- ADMINS TABLE
-- ============================================
CREATE TABLE admins (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- ACADEMIC LEVELS (Fixed)
-- ============================================
CREATE TABLE academic_levels (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) UNIQUE NOT NULL,
    display_order INT
);

-- ============================================
-- ARCHIVES
-- ============================================
CREATE TABLE archives (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(200) NOT NULL,
    thumbnail_url TEXT,
    description TEXT,
    created_by UUID REFERENCES admins(id),
    last_edited_by UUID REFERENCES admins(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- CHAPTERS (Fixed per archive)
-- ============================================
CREATE TABLE chapters (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    archive_id UUID REFERENCES archives(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    chapter_number INT,
    UNIQUE(archive_id, chapter_number)
);

-- ============================================
-- TOPICS (Dynamic)
-- ============================================
CREATE TABLE topics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    chapter_id UUID REFERENCES chapters(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    created_by UUID REFERENCES admins(id),
    last_edited_by UUID REFERENCES admins(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- DIFFICULTY LEVELS (Dynamic)
-- ============================================
CREATE TABLE difficulty_levels (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(50) UNIQUE NOT NULL,
    created_by UUID REFERENCES admins(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- TAGS (Dynamic)
-- ============================================
CREATE TABLE tags (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) UNIQUE NOT NULL,
    created_by UUID REFERENCES admins(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- SOURCES (Dynamic)  -- MODIFIED: name only
-- ============================================
CREATE TABLE sources (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(200) UNIQUE NOT NULL,
    created_by UUID REFERENCES admins(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- YEARS (Dynamic)  -- NEW
-- Managed list of years, selectable like tags/sources.
-- A year is attached to a source PER QUESTION (see question_sources.year_id),
-- so you can sort by source alone, by year alone, or show "Source (Year)".
-- ============================================
CREATE TABLE years (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    value INT UNIQUE NOT NULL,
    created_by UUID REFERENCES admins(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- QUESTIONS TABLE (Complete with Image + Video Support)
-- ============================================
CREATE TABLE questions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    topic_id UUID REFERENCES topics(id) ON DELETE CASCADE,
    
    -- Question Type: 'MCQ', 'MCQ_CLUSTER', 'WRITTEN'
    type VARCHAR(20) NOT NULL,
    
    -- Difficulty
    difficulty_id UUID REFERENCES difficulty_levels(id),
    
    -- STEM (Optional - used in cluster questions)
    -- Supports text + LaTeX + multiple images
    stem_text TEXT,
    stem_images JSONB, -- [{"url": "/uploads/...", "label": "Figure 1"}]
    
    -- MAIN QUESTION (for non-cluster questions)
    -- Supports text + LaTeX + multiple images
    question_text TEXT,
    question_images JSONB, -- [{"url": "/uploads/...", "label": "Diagram A"}]
    
    -- ANSWER (for all question types)
    -- Supports text + LaTeX + multiple images
    answer_text TEXT,
    answer_images JSONB, -- [{"url": "/uploads/...", "label": "Solution diagram"}]
    
    -- VIDEO LINKS (NEW - optional, for all question types)
    -- [{"url": "https://youtu.be/...", "label": "Full solution", "platform": "youtube"}]
    video_links JSONB,
    
    -- MCQ OPTIONS (for simple MCQ only)
    -- Each option can have text + images + correct flag
    options JSONB, -- [{"text": "...", "images": [{"url": "...", "label": "..."}], "isCorrect": true/false}]
    
    -- SUB-QUESTIONS (for cluster MCQ or structured written)
    -- Each sub-question is a complete question object
    sub_questions JSONB, 
    -- Structure:
    -- [
    --   {
    --     "questionText": "...",
    --     "questionImages": [{"url": "...", "label": "..."}],
    --     "options": [{"text": "...", "images": [...], "isCorrect": true/false}], // for MCQ_CLUSTER
    --     "answerText": "...",
    --     "answerImages": [{"url": "...", "label": "..."}]
    --   }
    -- ]
    
    -- Audit fields
    created_by UUID REFERENCES admins(id),
    last_edited_by UUID REFERENCES admins(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraints
    CONSTRAINT valid_question_type CHECK (type IN ('MCQ', 'MCQ_CLUSTER', 'WRITTEN'))
);

-- ============================================
-- QUESTION RELATIONSHIPS
-- ============================================

-- Question-Academic Level (Many-to-Many)
CREATE TABLE question_academic_levels (
    question_id UUID REFERENCES questions(id) ON DELETE CASCADE,
    academic_level_id INT REFERENCES academic_levels(id),
    PRIMARY KEY (question_id, academic_level_id)
);

-- Question-Tags (Many-to-Many)
CREATE TABLE question_tags (
    question_id UUID REFERENCES questions(id) ON DELETE CASCADE,
    tag_id UUID REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (question_id, tag_id)
);

-- Question-Sources (Many-to-Many)  -- MODIFIED: optional year_id per link
-- year_id is nullable: a source may or may not be tied to a year for this question.
CREATE TABLE question_sources (
    question_id UUID REFERENCES questions(id) ON DELETE CASCADE,
    source_id UUID REFERENCES sources(id) ON DELETE CASCADE,
    year_id UUID REFERENCES years(id) ON DELETE SET NULL,
    PRIMARY KEY (question_id, source_id)
);

-- ============================================
-- INDEXES FOR PERFORMANCE
-- ============================================
CREATE INDEX idx_questions_topic ON questions(topic_id);
CREATE INDEX idx_questions_difficulty ON questions(difficulty_id);
CREATE INDEX idx_questions_type ON questions(type);
CREATE INDEX idx_topics_chapter ON topics(chapter_id);
CREATE INDEX idx_chapters_archive ON chapters(archive_id);
CREATE INDEX idx_questions_created_at ON questions(created_at DESC);

-- Source / Year sorting indexes (NEW)
CREATE INDEX idx_question_sources_source ON question_sources(source_id);
CREATE INDEX idx_question_sources_year ON question_sources(year_id);

-- Full-text search indexes (for keyword search)
CREATE INDEX idx_questions_stem_text ON questions USING gin(to_tsvector('english', COALESCE(stem_text, '')));
CREATE INDEX idx_questions_question_text ON questions USING gin(to_tsvector('english', COALESCE(question_text, '')));
CREATE INDEX idx_questions_answer_text ON questions USING gin(to_tsvector('english', COALESCE(answer_text, '')));

-- ============================================
-- SEED DATA
-- ============================================

-- Seed Academic Levels (Fixed)
INSERT INTO academic_levels (name, display_order) VALUES
('Class 5', 1),
('Class 6', 2),
('Class 7', 3),
('Class 8', 4),
('SSC', 5),
('HSC', 6),
('Admission: Engineering', 7),
('Admission: University', 8),
('Admission: Medical', 9)
ON CONFLICT (name) DO NOTHING;

-- Seed Default Difficulty Levels
INSERT INTO difficulty_levels (name) VALUES
('Easy'),
('Medium'),
('Hard')
ON CONFLICT (name) DO NOTHING;

-- Seed Years (adjust the range as you like; admins can add more later)
INSERT INTO years (value)
SELECT generate_series(1990, EXTRACT(YEAR FROM CURRENT_DATE)::int)
ON CONFLICT (value) DO NOTHING;

-- ============================================
-- HELPFUL VIEWS
-- ============================================

-- View for question statistics
CREATE OR REPLACE VIEW question_stats AS
SELECT 
    q.type,
    d.name as difficulty,
    COUNT(*) as total_questions,
    COUNT(DISTINCT q.topic_id) as topics_covered
FROM questions q
LEFT JOIN difficulty_levels d ON q.difficulty_id = d.id
GROUP BY q.type, d.name;

-- View for complete question details
CREATE OR REPLACE VIEW question_details AS
SELECT 
    q.id,
    q.type,
    q.stem_text,
    q.question_text,
    q.answer_text,
    t.name as topic_name,
    ch.name as chapter_name,
    a.name as archive_name,
    d.name as difficulty_name,
    q.created_at,
    q.updated_at,
    c.username as created_by_name,
    e.username as edited_by_name
FROM questions q
LEFT JOIN topics t ON q.topic_id = t.id
LEFT JOIN chapters ch ON t.chapter_id = ch.id
LEFT JOIN archives a ON ch.archive_id = a.id
LEFT JOIN difficulty_levels d ON q.difficulty_id = d.id
LEFT JOIN admins c ON q.created_by = c.id
LEFT JOIN admins e ON q.last_edited_by = e.id;

-- View for source + year display & sorting (NEW)
-- Gives one row per (question, source) with the optional year resolved.
-- source_label = "Source (Year)" when a year is set, else just "Source".
-- Use source_id to sort/filter by source only, year_value to sort/filter by year only.
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

-- ============================================
-- FUNCTIONS FOR VALIDATION
-- ============================================

-- Function to validate MCQ options
CREATE OR REPLACE FUNCTION validate_mcq_options()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.type = 'MCQ' THEN
        -- Check if options exist
        IF NEW.options IS NULL OR jsonb_array_length(NEW.options) < 2 THEN
            RAISE EXCEPTION 'MCQ must have at least 2 options';
        END IF;
        
        -- Check if at least one option is marked as correct
        IF NOT EXISTS (
            SELECT 1 
            FROM jsonb_array_elements(NEW.options) AS opt
            WHERE (opt->>'isCorrect')::boolean = true
        ) THEN
            RAISE EXCEPTION 'MCQ must have at least one correct answer';
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to validate MCQ options
CREATE TRIGGER trigger_validate_mcq_options
    BEFORE INSERT OR UPDATE ON questions
    FOR EACH ROW
    EXECUTE FUNCTION validate_mcq_options();

-- Function to validate cluster MCQ
CREATE OR REPLACE FUNCTION validate_mcq_cluster()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.type = 'MCQ_CLUSTER' THEN
        -- Check if stem exists
        IF NEW.stem_text IS NULL OR NEW.stem_text = '' THEN
            RAISE EXCEPTION 'MCQ_CLUSTER must have stem text';
        END IF;
        
        -- Check if sub-questions exist
        IF NEW.sub_questions IS NULL OR jsonb_array_length(NEW.sub_questions) = 0 THEN
            RAISE EXCEPTION 'MCQ_CLUSTER must have at least one sub-question';
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to validate cluster MCQ
CREATE TRIGGER trigger_validate_mcq_cluster
    BEFORE INSERT OR UPDATE ON questions
    FOR EACH ROW
    EXECUTE FUNCTION validate_mcq_cluster();

-- ============================================
-- UTILITY FUNCTIONS
-- ============================================

-- Function to count questions by type
CREATE OR REPLACE FUNCTION count_questions_by_type()
RETURNS TABLE(question_type VARCHAR, count BIGINT) AS $$
BEGIN
    RETURN QUERY
    SELECT type, COUNT(*)
    FROM questions
    GROUP BY type
    ORDER BY type;
END;
$$ LANGUAGE plpgsql;

-- Function to get questions by archive
CREATE OR REPLACE FUNCTION get_questions_by_archive(archive_uuid UUID)
RETURNS TABLE(
    question_id UUID,
    question_type VARCHAR,
    topic_name VARCHAR,
    chapter_name VARCHAR,
    difficulty_name VARCHAR
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        q.id,
        q.type,
        t.name,
        ch.name,
        d.name
    FROM questions q
    JOIN topics t ON q.topic_id = t.id
    JOIN chapters ch ON t.chapter_id = ch.id
    LEFT JOIN difficulty_levels d ON q.difficulty_id = d.id
    WHERE ch.archive_id = archive_uuid
    ORDER BY ch.chapter_number, t.name;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================

COMMENT ON TABLE questions IS 'Main questions table supporting MCQ, MCQ_CLUSTER, and WRITTEN types with full image + video support';
COMMENT ON COLUMN questions.type IS 'Question type: MCQ (simple multiple choice), MCQ_CLUSTER (stem with multiple MCQs), WRITTEN (descriptive)';
COMMENT ON COLUMN questions.stem_text IS 'Common text for cluster questions (optional, supports LaTeX)';
COMMENT ON COLUMN questions.stem_images IS 'Array of image objects for stem: [{"url": "...", "label": "..."}]';
COMMENT ON COLUMN questions.question_text IS 'Main question text (supports LaTeX)';
COMMENT ON COLUMN questions.question_images IS 'Array of image objects for question';
COMMENT ON COLUMN questions.answer_text IS 'Answer explanation (supports LaTeX)';
COMMENT ON COLUMN questions.answer_images IS 'Array of image objects for answer';
COMMENT ON COLUMN questions.video_links IS 'Optional array of video link objects: [{"url": "...", "label": "...", "platform": "youtube"}]';
COMMENT ON COLUMN questions.options IS 'MCQ options with text, images, and correct flag';
COMMENT ON COLUMN questions.sub_questions IS 'Array of sub-question objects for cluster/structured questions';
COMMENT ON TABLE sources IS 'Dynamic source list (name only). Year is attached per-question via question_sources.year_id';
COMMENT ON TABLE years IS 'Dynamic year list, selectable. Linked to a source per question via question_sources.year_id';
COMMENT ON COLUMN question_sources.year_id IS 'Optional year for this source on this question (nullable)';

-- ============================================
-- COMPLETE SCHEMA
-- ============================================

-- Display success message
DO $$
BEGIN
    RAISE NOTICE '✅ Question Bank Database Schema Created Successfully!';
    RAISE NOTICE '📊 Tables Created: 13';
    RAISE NOTICE '🔍 Indexes Created: 11';
    RAISE NOTICE '👁️  Views Created: 3';
    RAISE NOTICE '⚙️  Functions Created: 4';
    RAISE NOTICE '🎯 Triggers Created: 2';
    RAISE NOTICE '';
    RAISE NOTICE '📝 Question Types Supported:';
    RAISE NOTICE '   - MCQ (2-10 flexible options)';
    RAISE NOTICE '   - MCQ_CLUSTER (stem + multiple MCQs)';
    RAISE NOTICE '   - WRITTEN (with/without stem, single/multiple parts)';
    RAISE NOTICE '';
    RAISE NOTICE '🖼️  Image Support:';
    RAISE NOTICE '   - Stem images';
    RAISE NOTICE '   - Question images';
    RAISE NOTICE '   - Option images (for MCQ)';
    RAISE NOTICE '   - Answer images';
    RAISE NOTICE '';
    RAISE NOTICE '🎬 Video Link Support (optional, all types)';
    RAISE NOTICE '📅 Year Support (per-source, sortable by source or year)';
    RAISE NOTICE '';
    RAISE NOTICE '✨ Ready to use!';
END $$;