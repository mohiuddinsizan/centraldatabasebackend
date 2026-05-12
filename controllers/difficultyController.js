import pool from '../config/database.js';

// Create Difficulty Level
const createDifficulty = async (req, res) => {
  try {
    const { name } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Difficulty name is required' });
    }

    const result = await pool.query(
      `INSERT INTO difficulty_levels (name, created_by)
       VALUES ($1, $2) RETURNING *`,
      [name, req.admin.id]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Difficulty level already exists' });
    }
    res.status(500).json({ error: error.message });
  }
};

// Get All Difficulty Levels
const getAllDifficulties = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT d.*,
              a.username as created_by_name,
              COUNT(q.id) as usage_count
       FROM difficulty_levels d
       LEFT JOIN admins a ON d.created_by = a.id
       LEFT JOIN questions q ON d.id = q.difficulty_id
       GROUP BY d.id, a.username
       ORDER BY d.name ASC`
    );

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Update Difficulty Level
const updateDifficulty = async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    const result = await pool.query(
      `UPDATE difficulty_levels 
       SET name = $1
       WHERE id = $2
       RETURNING *`,
      [name, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Difficulty level not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Difficulty level already exists' });
    }
    res.status(500).json({ error: error.message });
  }
};

// Delete Difficulty Level
const deleteDifficulty = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'DELETE FROM difficulty_levels WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Difficulty level not found' });
    }

    res.json({ message: 'Difficulty level deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export {
  createDifficulty,
  getAllDifficulties,
  updateDifficulty,
  deleteDifficulty,
};