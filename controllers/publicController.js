import pool from '../config/database.js';

// ============================================
// PUBLIC (read-only) API for external apps consuming the central question bank.
// Everything is reported as status: 'active' (there is no inactive state).
// ============================================

// Reusable per-question aggregates (tags / units / natures / levels / sources).
const QUESTION_LATERALS = `
  LEFT JOIN LATERAL (
    SELECT COALESCE(json_agg(DISTINCT jsonb_build_object('id', tg.id, 'name', tg.name))
           FILTER (WHERE tg.id IS NOT NULL), '[]') AS tags
    FROM question_tags qt JOIN tags tg ON qt.tag_id = tg.id
    WHERE qt.question_id = q.id
  ) tag_data ON true
  LEFT JOIN LATERAL (
    SELECT COALESCE(json_agg(DISTINCT jsonb_build_object('id', u.id, 'name', u.name))
           FILTER (WHERE u.id IS NOT NULL), '[]') AS units
    FROM question_units qu JOIN units u ON qu.unit_id = u.id
    WHERE qu.question_id = q.id
  ) unit_data ON true
  LEFT JOIN LATERAL (
    SELECT COALESCE(json_agg(DISTINCT jsonb_build_object('id', n.id, 'name', n.name))
           FILTER (WHERE n.id IS NOT NULL), '[]') AS natures
    FROM question_natures qn JOIN natures n ON qn.nature_id = n.id
    WHERE qn.question_id = q.id
  ) nature_data ON true
  LEFT JOIN LATERAL (
    SELECT COALESCE(json_agg(DISTINCT jsonb_build_object('id', al.id, 'name', al.name))
           FILTER (WHERE al.id IS NOT NULL), '[]') AS academic_levels
    FROM question_academic_levels qal JOIN academic_levels al ON qal.academic_level_id = al.id
    WHERE qal.question_id = q.id
  ) level_data ON true
  LEFT JOIN LATERAL (
    SELECT COALESCE(json_agg(jsonb_build_object(
             'id', s.id, 'name', s.name, 'yearId', y.id, 'year', y.value,
             'label', CASE WHEN y.value IS NOT NULL THEN s.name || ' (' || y.value || ')' ELSE s.name END
           ) ORDER BY y.value DESC NULLS LAST, s.name ASC)
           FILTER (WHERE s.id IS NOT NULL), '[]') AS sources
    FROM question_sources qs JOIN sources s ON qs.source_id = s.id
    LEFT JOIN years y ON qs.year_id = y.id
    WHERE qs.question_id = q.id
  ) source_data ON true
`;

// ============================================
// LISTS
// ============================================

// GET /archives
const getArchives = async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, name, thumbnail_url, description, created_at, updated_at, 'active' AS status
       FROM archives ORDER BY name ASC`
    );
    res.json(r.rows);
  } catch (error) {
    console.error('Public getArchives error:', error);
    res.status(500).json({ error: error.message });
  }
};

// GET /chapters            (optional ?archiveId=)
const getChapters = async (req, res) => {
  try {
    const { archiveId } = req.query;
    const params = [];
    let where = '';
    if (archiveId) { params.push(archiveId); where = 'WHERE archive_id = $1'; }
    const r = await pool.query(
      `SELECT id, archive_id, name, chapter_number, 'active' AS status
       FROM chapters ${where} ORDER BY archive_id, chapter_number ASC`,
      params
    );
    res.json(r.rows);
  } catch (error) {
    console.error('Public getChapters error:', error);
    res.status(500).json({ error: error.message });
  }
};

// GET /topics              (optional ?chapterId=)
const getTopics = async (req, res) => {
  try {
    const { chapterId } = req.query;
    const params = [];
    let where = '';
    if (chapterId) { params.push(chapterId); where = 'WHERE chapter_id = $1'; }
    const r = await pool.query(
      `SELECT id, chapter_id, name, created_at, updated_at, 'active' AS status
       FROM topics ${where} ORDER BY name ASC`,
      params
    );
    res.json(r.rows);
  } catch (error) {
    console.error('Public getTopics error:', error);
    res.status(500).json({ error: error.message });
  }
};

// GET /classes   (academic levels — Class 5..HSC, admission tracks, etc.)
const getClasses = async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, name, display_order, 'active' AS status
       FROM academic_levels ORDER BY display_order ASC, name ASC`
    );
    res.json(r.rows);
  } catch (error) {
    console.error('Public getClasses error:', error);
    res.status(500).json({ error: error.message });
  }
};

// ============================================
// QUESTIONS  —  GET /questions
// Full question objects. Supports incremental sync + pagination.
//   ?since=<ISO timestamp>   only questions updated at/after this time (inclusive)
//   ?page= & ?limit=         pagination (limit max 200, default 50)
//   ?archiveId= ?chapterId= ?topicId=   optional scope filters
// Ordered by updated_at ASC so the consumer can advance its cursor safely.
// ============================================
const getQuestions = async (req, res) => {
  try {
    const { since, archiveId, chapterId, topicId, page = 1, limit = 50 } = req.query;

    if (since && Number.isNaN(Date.parse(since))) {
      return res.status(400).json({ error: 'Invalid `since` timestamp (use ISO 8601, e.g. 2026-06-22T10:00:00Z)' });
    }

    const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
    const pg = Math.max(parseInt(page, 10) || 1, 1);
    const offset = (pg - 1) * lim;
    const sinceParam = since ? new Date(since).toISOString() : null;

    const conditions = ['($1::timestamp IS NULL OR q.updated_at >= $1::timestamp)'];
    const params = [sinceParam];
    let p = 2;
    if (archiveId) { conditions.push(`a.id = $${p++}`); params.push(archiveId); }
    if (chapterId) { conditions.push(`ch.id = $${p++}`); params.push(chapterId); }
    if (topicId)   { conditions.push(`t.id = $${p++}`);  params.push(topicId); }
    const where = `WHERE ${conditions.join(' AND ')}`;

    const baseFrom = `
      FROM questions q
      JOIN topics t ON q.topic_id = t.id
      JOIN chapters ch ON t.chapter_id = ch.id
      JOIN archives a ON ch.archive_id = a.id
      LEFT JOIN difficulty_levels d ON q.difficulty_id = d.id
    `;

    const countRes = await pool.query(`SELECT COUNT(*)::int AS count ${baseFrom} ${where}`, params);
    const total = countRes.rows[0].count;

    const dataRes = await pool.query(
      `SELECT
         q.id, q.type, q.search_code,
         q.stem_text, q.stem_images,
         q.question_text, q.question_images,
         q.answer_text, q.answer_images,
         q.video_links, q.options, q.sub_questions,
         q.difficulty_id, q.topic_id,
         q.created_at, q.updated_at,
         'active' AS status,
         t.name AS topic_name,
         ch.id AS chapter_id, ch.name AS chapter_name, ch.chapter_number,
         a.id AS archive_id, a.name AS archive_name,
         d.name AS difficulty_name,
         tag_data.tags,
         unit_data.units,
         nature_data.natures,
         level_data.academic_levels,
         source_data.sources
       ${baseFrom}
       ${QUESTION_LATERALS}
       ${where}
       ORDER BY q.updated_at ASC, q.id ASC
       LIMIT $${p} OFFSET $${p + 1}`,
      [...params, lim, offset]
    );

    res.json({
      questions: dataRes.rows,
      pagination: { total, page: pg, limit: lim, totalPages: Math.ceil(total / lim) },
      since: sinceParam,
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Public getQuestions error:', error);
    res.status(500).json({ error: error.message });
  }
};

// ============================================
// SYNC STATUS  —  GET /sync/status
// Cheap heartbeat: is there anything new since the consumer last synced?
// ============================================
const getSyncStatus = async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT NOW() AS server_time,
              MAX(updated_at) AS latest_updated_at,
              COUNT(*)::int AS total_questions
       FROM questions`
    );
    const row = r.rows[0];
    res.json({
      serverTime: row.server_time,
      latestUpdatedAt: row.latest_updated_at, // null if there are no questions yet
      totalQuestions: row.total_questions,
    });
  } catch (error) {
    console.error('Public getSyncStatus error:', error);
    res.status(500).json({ error: error.message });
  }
};

// ============================================
// MANIFEST  —  GET /questions/manifest
// Lightweight list of every question id + updated_at. The consumer diffs this
// against its local copy to detect DELETES (ids it has that are missing here).
// ============================================
const getQuestionsManifest = async (req, res) => {
  try {
    const r = await pool.query(`SELECT id, updated_at FROM questions ORDER BY updated_at ASC, id ASC`);
    res.json({
      count: r.rows.length,
      serverTime: new Date().toISOString(),
      questions: r.rows, // [{ id, updated_at }, ...]
    });
  } catch (error) {
    console.error('Public getQuestionsManifest error:', error);
    res.status(500).json({ error: error.message });
  }
};

export {
  getArchives,
  getChapters,
  getTopics,
  getClasses,
  getQuestions,
  getSyncStatus,
  getQuestionsManifest,
};