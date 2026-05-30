import pool from '../config/database.js';

// Create Unit (predefined, selectable like tags)
const createUnit = async (req, res) => {
  try {
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Unit name is required' });
    }

    const result = await pool.query(
      `INSERT INTO units (name, created_by)
       VALUES ($1, $2) RETURNING *`,
      [name.trim(), req.admin.id]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'A unit with this name already exists' });
    }
    res.status(500).json({ error: error.message });
  }
};

// Get All Units (newest first; includes usage count)
const getAllUnits = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.*,
              a.username as created_by_name,
              COUNT(qu.question_id) as usage_count
       FROM units u
       LEFT JOIN admins a ON u.created_by = a.id
       LEFT JOIN question_units qu ON u.id = qu.unit_id
       GROUP BY u.id, a.username
       ORDER BY u.created_at DESC`
    );

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Update Unit
const updateUnit = async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    const result = await pool.query(
      `UPDATE units 
       SET name = COALESCE($1, name)
       WHERE id = $2
       RETURNING *`,
      [name ? name.trim() : null, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Unit not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'A unit with this name already exists' });
    }
    res.status(500).json({ error: error.message });
  }
};

// Delete Unit (unlinks from questions automatically via ON DELETE CASCADE on join)
const deleteUnit = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'DELETE FROM units WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Unit not found' });
    }

    res.json({ message: 'Unit deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export {
  createUnit,
  getAllUnits,
  updateUnit,
  deleteUnit,
};