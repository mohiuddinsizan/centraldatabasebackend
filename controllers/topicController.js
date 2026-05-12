import pool from '../config/database.js';

// Create Topic
const createTopic = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { chapterId, name } = req.body;

    if (!chapterId || !name) {
      return res.status(400).json({ error: 'Chapter ID and name are required' });
    }

    await client.query('BEGIN');

    const result = await client.query(
      `INSERT INTO topics (chapter_id, name, created_by, last_edited_by)
       VALUES ($1, $2, $3, $3) RETURNING *`,
      [chapterId, name, req.admin.id]
    );

    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
};

// Get Topics by Chapter
const getTopicsByChapter = async (req, res) => {
  try {
    const { chapterId } = req.params;

    const result = await pool.query(
      `SELECT t.*,
              c.username as created_by_name,
              e.username as edited_by_name,
              ch.name as chapter_name
       FROM topics t
       LEFT JOIN admins c ON t.created_by = c.id
       LEFT JOIN admins e ON t.last_edited_by = e.id
       LEFT JOIN chapters ch ON t.chapter_id = ch.id
       WHERE t.chapter_id = $1
       ORDER BY t.created_at ASC`,
      [chapterId]
    );

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Get All Topics
const getAllTopics = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT t.*,
              c.username as created_by_name,
              e.username as edited_by_name,
              ch.name as chapter_name,
              a.name as archive_name
       FROM topics t
       LEFT JOIN admins c ON t.created_by = c.id
       LEFT JOIN admins e ON t.last_edited_by = e.id
       LEFT JOIN chapters ch ON t.chapter_id = ch.id
       LEFT JOIN archives a ON ch.archive_id = a.id
       ORDER BY a.name, ch.chapter_number, t.name`
    );

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Update Topic
const updateTopic = async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    const result = await pool.query(
      `UPDATE topics 
       SET name = $1,
           last_edited_by = $2,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3
       RETURNING *`,
      [name, req.admin.id, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Topic not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Delete Topic
const deleteTopic = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'DELETE FROM topics WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Topic not found' });
    }

    res.json({ message: 'Topic deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export {
  createTopic,
  getTopicsByChapter,
  getAllTopics,
  updateTopic,
  deleteTopic,
};