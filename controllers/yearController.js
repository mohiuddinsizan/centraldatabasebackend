import pool from '../config/database.js';

// Create Year (separate entity; gets linked to a source per-question at upload time)
const createYear = async (req, res) => {
  try {
    const { value } = req.body;
    const yearValue = parseInt(value, 10);

    if (!yearValue || Number.isNaN(yearValue)) {
      return res.status(400).json({ error: 'A valid year value is required' });
    }

    const result = await pool.query(
      `INSERT INTO years (value, created_by)
       VALUES ($1, $2) RETURNING *`,
      [yearValue, req.admin.id]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'This year already exists' });
    }
    res.status(500).json({ error: error.message });
  }
};

// Get All Years (newest first; includes how many question-source links use each year)
const getAllYears = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT y.*,
              a.username as created_by_name,
              COUNT(qs.question_id) as usage_count
       FROM years y
       LEFT JOIN admins a ON y.created_by = a.id
       LEFT JOIN question_sources qs ON y.id = qs.year_id
       GROUP BY y.id, a.username
       ORDER BY y.value DESC`
    );

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Update Year
const updateYear = async (req, res) => {
  try {
    const { id } = req.params;
    const { value } = req.body;
    const yearValue = value !== undefined ? parseInt(value, 10) : null;

    if (value !== undefined && (!yearValue || Number.isNaN(yearValue))) {
      return res.status(400).json({ error: 'A valid year value is required' });
    }

    const result = await pool.query(
      `UPDATE years 
       SET value = COALESCE($1, value)
       WHERE id = $2
       RETURNING *`,
      [yearValue, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Year not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'This year already exists' });
    }
    res.status(500).json({ error: error.message });
  }
};

// Delete Year
// Note: question_sources.year_id is ON DELETE SET NULL, so deleting a year does
// NOT delete questions — it just unlinks the year from any question-source rows
// that used it (those sources stay, they simply lose their year).
const deleteYear = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'DELETE FROM years WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Year not found' });
    }

    res.json({ message: 'Year deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export {
  createYear,
  getAllYears,
  updateYear,
  deleteYear,
};