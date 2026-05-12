import pool from '../config/database.js';
import { getPresignedUrl } from '../config/s3.js';

// Helper: attach presigned thumbnail_url to every archive row
const withPresignedUrls = async (rows) => {
  return Promise.all(
    rows.map(async (row) => ({
      ...row,
      thumbnail_url: await getPresignedUrl(row.thumbnail_url),
    }))
  );
};

// Helper: extract the S3 key (or local path) to store in DB
// S3:    req.file.key      → "uploads/xxxx.jpg"
// Local: req.file.filename → "xxxx.jpg"  (we prefix uploads/)
const getThumbnailKey = (file) => {
  if (!file) return null;
  if (file.key) return file.key;               // S3: already "uploads/xxxx.jpg"
  return `uploads/${file.filename}`;           // local disk
};

// ── Create Archive ──────────────────────────────────────────────
const createArchive = async (req, res) => {
  const client = await pool.connect();
  try {
    const { name, description, class: archiveClass } = req.body;
    const thumbnailKey = getThumbnailKey(req.file); // store key, never full URL

    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO archives (name, thumbnail_url, description, class, created_by, last_edited_by)
       VALUES ($1, $2, $3, $4, $5, $5) RETURNING *`,
      [name, thumbnailKey, description, archiveClass, req.admin.id]
    );
    await client.query('COMMIT');

    const [archive] = await withPresignedUrls([result.rows[0]]);
    res.status(201).json(archive);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Create archive error:', error.message);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
};

// ── Get All Archives ────────────────────────────────────────────
const getArchives = async (req, res) => {
  try {
    const { class: filterClass } = req.query;

    let query = `
      SELECT a.*,
             c.username as created_by_name,
             e.username as edited_by_name,
             COUNT(DISTINCT ch.id) as chapter_count
      FROM archives a
      LEFT JOIN admins c ON a.created_by = c.id
      LEFT JOIN admins e ON a.last_edited_by = e.id
      LEFT JOIN chapters ch ON a.id = ch.archive_id
    `;

    const params = [];
    if (filterClass) {
      query += ` WHERE a.class = $1`;
      params.push(filterClass);
    }

    query += ` GROUP BY a.id, c.username, e.username ORDER BY a.created_at DESC`;

    const result = await pool.query(query, params);
    const archives = await withPresignedUrls(result.rows);
    res.json(archives);
  } catch (error) {
    console.error('Get archives error:', error.message);
    res.status(500).json({ error: error.message });
  }
};

// ── Update Archive ──────────────────────────────────────────────
const updateArchive = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, class: archiveClass } = req.body;
    const thumbnailKey = getThumbnailKey(req.file); // null if no new file uploaded

    const result = await pool.query(
      `UPDATE archives
       SET name             = COALESCE($1, name),
           description      = COALESCE($2, description),
           class            = COALESCE($3, class),
           thumbnail_url    = COALESCE($4, thumbnail_url),
           last_edited_by   = $5,
           updated_at       = CURRENT_TIMESTAMP
       WHERE id = $6
       RETURNING *`,
      [name, description, archiveClass, thumbnailKey, req.admin.id, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Archive not found' });
    }

    const [archive] = await withPresignedUrls([result.rows[0]]);
    res.json(archive);
  } catch (error) {
    console.error('Update archive error:', error.message);
    res.status(500).json({ error: error.message });
  }
};

// ── Delete Archive ──────────────────────────────────────────────
const deleteArchive = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'DELETE FROM archives WHERE id = $1 RETURNING *',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Archive not found' });
    }
    res.json({ message: 'Archive deleted successfully' });
  } catch (error) {
    console.error('Delete archive error:', error.message);
    res.status(500).json({ error: error.message });
  }
};

export { createArchive, getArchives, updateArchive, deleteArchive };