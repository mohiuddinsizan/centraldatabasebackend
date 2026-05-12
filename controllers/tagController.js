import pool from '../config/database.js';

// Create Tag
const createTag = async (req, res) => {
  try {
    const { name } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Tag name is required' });
    }

    const result = await pool.query(
      `INSERT INTO tags (name, created_by)
       VALUES ($1, $2) RETURNING *`,
      [name, req.admin.id]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Tag already exists' });
    }
    res.status(500).json({ error: error.message });
  }
};

// Get All Tags
const getAllTags = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT t.*,
              a.username as created_by_name,
              COUNT(qt.question_id) as usage_count
       FROM tags t
       LEFT JOIN admins a ON t.created_by = a.id
       LEFT JOIN question_tags qt ON t.id = qt.tag_id
       GROUP BY t.id, a.username
       ORDER BY t.name ASC`
    );

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Update Tag
const updateTag = async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    const result = await pool.query(
      `UPDATE tags 
       SET name = $1
       WHERE id = $2
       RETURNING *`,
      [name, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Tag not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Tag name already exists' });
    }
    res.status(500).json({ error: error.message });
  }
};

// Delete Tag
const deleteTag = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'DELETE FROM tags WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Tag not found' });
    }

    res.json({ message: 'Tag deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export {
  createTag,
  getAllTags,
  updateTag,
  deleteTag,
};