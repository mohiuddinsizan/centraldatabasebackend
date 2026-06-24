import pool from '../config/database.js';

// ============================================
// GET /natures  ->  [{ id, name, display_order }]
// Fixed list: Unique / Modified / Brainstorming / Previous Year Question
// ============================================
const getNatures = async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, display_order FROM natures ORDER BY display_order ASC NULLS LAST, name ASC'
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Get natures error:', error);
    res.status(500).json({ error: error.message });
  }
};

export { getNatures };