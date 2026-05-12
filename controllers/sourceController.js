import pool from '../config/database.js';

// Create Source
const createSource = async (req, res) => {
  try {
    const { name, type, year } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Source name is required' });
    }

    const result = await pool.query(
      `INSERT INTO sources (name, type, year, created_by)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [name, type, year, req.admin.id]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Get All Sources
const getAllSources = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.*,
              a.username as created_by_name,
              COUNT(qs.question_id) as usage_count
       FROM sources s
       LEFT JOIN admins a ON s.created_by = a.id
       LEFT JOIN question_sources qs ON s.id = qs.source_id
       GROUP BY s.id, a.username
       ORDER BY s.created_at DESC`
    );

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Update Source
const updateSource = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, type, year } = req.body;

    const result = await pool.query(
      `UPDATE sources 
       SET name = COALESCE($1, name),
           type = COALESCE($2, type),
           year = COALESCE($3, year)
       WHERE id = $4
       RETURNING *`,
      [name, type, year, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Source not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Delete Source
const deleteSource = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'DELETE FROM sources WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Source not found' });
    }

    res.json({ message: 'Source deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export {
  createSource,
  getAllSources,
  updateSource,
  deleteSource,
};