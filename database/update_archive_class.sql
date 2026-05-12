-- Add class field to archives table
ALTER TABLE archives ADD COLUMN class VARCHAR(50);

-- Add index for filtering
CREATE INDEX idx_archives_class ON archives(class);

-- Update existing archives (optional - set to null for now)
UPDATE archives SET class = NULL WHERE class IS NULL;