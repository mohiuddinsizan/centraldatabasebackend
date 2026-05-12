import pool from '../config/database.js';

// ============================================
// GET ANALYTICS — overall + per-archive + date-range admin stats
// ============================================
export const getAnalytics = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    // ── 1. Overall totals ──────────────────────────────────────────────────
    const totalsRes = await pool.query(`
      SELECT
        COUNT(*)                                              AS total,
        COUNT(*) FILTER (WHERE type = 'MCQ')                 AS mcq,
        COUNT(*) FILTER (WHERE type = 'MCQ_CLUSTER')         AS cluster,
        COUNT(*) FILTER (WHERE type = 'WRITTEN')             AS written
      FROM questions
    `);

    const archiveCountRes = await pool.query(`SELECT COUNT(*) AS count FROM archives`);
    const chapterCountRes = await pool.query(`SELECT COUNT(*) AS count FROM chapters`);
    const topicCountRes   = await pool.query(`SELECT COUNT(*) AS count FROM topics`);

    // ── 2. Per-archive stats ───────────────────────────────────────────────
    const perArchiveRes = await pool.query(`
      SELECT
        a.id,
        a.name,
        a.class,
        a.thumbnail_url,
        COUNT(DISTINCT ch.id)                                                AS chapter_count,
        COUNT(DISTINCT t.id)                                                 AS topic_count,
        COUNT(DISTINCT q.id)                                                 AS question_count,
        COUNT(DISTINCT q.id) FILTER (WHERE q.type = 'MCQ')                  AS mcq_count,
        COUNT(DISTINCT q.id) FILTER (WHERE q.type = 'MCQ_CLUSTER')          AS cluster_count,
        COUNT(DISTINCT q.id) FILTER (WHERE q.type = 'WRITTEN')              AS written_count
      FROM archives a
      LEFT JOIN chapters ch ON ch.archive_id = a.id
      LEFT JOIN topics   t  ON t.chapter_id  = ch.id
      LEFT JOIN questions q ON q.topic_id    = t.id
      GROUP BY a.id, a.name, a.class, a.thumbnail_url
      ORDER BY question_count DESC
    `);

    // ── 3. Admin upload stats (optionally filtered by date range) ──────────
    let adminParams = [];
    let adminWhere  = '';
    if (startDate && endDate) {
      adminWhere  = `WHERE q.created_at >= $1 AND q.created_at < ($2::date + INTERVAL '1 day')`;
      adminParams = [startDate, endDate];
    }

    const adminRes = await pool.query(`
      SELECT
        a.id,
        a.username                                                    AS name,
        a.full_name,
        COUNT(q.id)                                                   AS total,
        COUNT(q.id) FILTER (WHERE q.type = 'MCQ')                    AS mcq,
        COUNT(q.id) FILTER (WHERE q.type = 'MCQ_CLUSTER')            AS cluster,
        COUNT(q.id) FILTER (WHERE q.type = 'WRITTEN')                AS written,
        MIN(q.created_at)                                             AS first_upload,
        MAX(q.created_at)                                             AS last_upload
      FROM admins a
      LEFT JOIN questions q ON q.created_by = a.id ${adminWhere ? 'AND ' + adminWhere.replace('WHERE ', '') : ''}
      GROUP BY a.id, a.username, a.full_name
      HAVING COUNT(q.id) > 0
      ORDER BY total DESC
    `, adminParams);

    // ── 4. Daily upload trend (last 30 days) ──────────────────────────────
    const trendRes = await pool.query(`
      SELECT
        DATE(created_at)::text AS day,
        COUNT(*)               AS count
      FROM questions
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY DATE(created_at)
      ORDER BY day ASC
    `);

    res.json({
      totals: {
        archives: parseInt(archiveCountRes.rows[0].count),
        chapters: parseInt(chapterCountRes.rows[0].count),
        topics:   parseInt(topicCountRes.rows[0].count),
        questions: parseInt(totalsRes.rows[0].total),
        mcq:       parseInt(totalsRes.rows[0].mcq),
        cluster:   parseInt(totalsRes.rows[0].cluster),
        written:   parseInt(totalsRes.rows[0].written),
      },
      perArchive: perArchiveRes.rows.map(r => ({
        id:            r.id,
        name:          r.name,
        class:         r.class,
        thumbnailUrl:  r.thumbnail_url,
        chapterCount:  parseInt(r.chapter_count),
        topicCount:    parseInt(r.topic_count),
        questionCount: parseInt(r.question_count),
        mcqCount:      parseInt(r.mcq_count),
        clusterCount:  parseInt(r.cluster_count),
        writtenCount:  parseInt(r.written_count),
      })),
      adminStats: adminRes.rows.map(r => ({
        id:          r.id,
        name:        r.full_name || r.name,
        username:    r.name,
        total:       parseInt(r.total),
        mcq:         parseInt(r.mcq),
        cluster:     parseInt(r.cluster),
        written:     parseInt(r.written),
        firstUpload: r.first_upload,
        lastUpload:  r.last_upload,
      })),
      trend: trendRes.rows.map(r => ({ day: r.day, count: parseInt(r.count) })),
      dateRange: startDate && endDate ? { startDate, endDate } : null,
    });
  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ error: error.message });
  }
};