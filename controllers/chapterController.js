import pool from '../config/database.js';

// Create Chapter
const createChapter = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { archiveId, name, chapterNumber } = req.body;

    if (!archiveId || !name || !chapterNumber) {
      return res.status(400).json({ error: 'Archive ID, name, and chapter number are required' });
    }

    await client.query('BEGIN');

    const result = await client.query(
      `INSERT INTO chapters (archive_id, name, chapter_number)
       VALUES ($1, $2, $3) RETURNING *`,
      [archiveId, name, chapterNumber]
    );

    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Chapter number already exists for this archive' });
    }
    
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
};

// Get Chapters by Archive
const getChaptersByArchive = async (req, res) => {
  try {
    const { archiveId } = req.params;

    const result = await pool.query(
      `SELECT c.*,
              a.name as archive_name,
              COUNT(t.id) as topic_count
       FROM chapters c
       LEFT JOIN archives a ON c.archive_id = a.id
       LEFT JOIN topics t ON c.id = t.chapter_id
       WHERE c.archive_id = $1
       GROUP BY c.id, a.name
       ORDER BY c.chapter_number ASC`,
      [archiveId]
    );

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Get All Chapters
const getAllChapters = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.*,
              a.name as archive_name,
              COUNT(t.id) as topic_count
       FROM chapters c
       LEFT JOIN archives a ON c.archive_id = a.id
       LEFT JOIN topics t ON c.id = t.chapter_id
       GROUP BY c.id, a.name
       ORDER BY a.name, c.chapter_number`
    );

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Update Chapter
const updateChapter = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, chapterNumber } = req.body;

    const result = await pool.query(
      `UPDATE chapters 
       SET name = COALESCE($1, name),
           chapter_number = COALESCE($2, chapter_number)
       WHERE id = $3
       RETURNING *`,
      [name, chapterNumber, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Chapter not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Delete Chapter
const deleteChapter = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'DELETE FROM chapters WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Chapter not found' });
    }

    res.json({ message: 'Chapter deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export {
  createChapter,
  getChaptersByArchive,
  getAllChapters,
  updateChapter,
  deleteChapter,
};