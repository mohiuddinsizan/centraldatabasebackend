import pool from '../config/database.js';

// ============================================
// HELPERS
// ============================================

// Normalize the `sources` payload into a uniform [{ sourceId, yearId }] shape.
const normalizeSources = (sources) => {
  if (!Array.isArray(sources)) return [];
  return sources
    .map((s) => {
      if (typeof s === 'string') return { sourceId: s, yearId: null };
      if (s && typeof s === 'object') {
        return { sourceId: s.sourceId || s.id || null, yearId: s.yearId || null };
      }
      return null;
    })
    .filter((s) => s && s.sourceId);
};

// Insert question_sources rows (with optional year_id) using parameterized SQL.
const insertQuestionSources = async (client, questionId, normalizedSources) => {
  if (!normalizedSources || normalizedSources.length === 0) return;
  const valuesSql = normalizedSources
    .map((_, i) => `($1, $${2 + i * 2}, $${3 + i * 2})`)
    .join(',');
  const flatParams = normalizedSources.flatMap((s) => [s.sourceId, s.yearId]);
  await client.query(
    `INSERT INTO question_sources (question_id, source_id, year_id) VALUES ${valuesSql}`,
    [questionId, ...flatParams]
  );
};

// Parse a comma-separated query param into a clean array (or null if empty).
const csvList = (v) => {
  if (v === undefined || v === null) return null;
  const arr = String(v).split(',').map((s) => s.trim()).filter(Boolean);
  return arr.length ? arr : null;
};

// ============================================
// CREATE QUESTION
// ============================================
const createQuestion = async (req, res) => {
  const client = await pool.connect();
  try {
    const {
      topicId, type, difficultyId,
      searchCode,
      stemText, stemImages,
      questionText, questionImages,
      answerText, answerImages,
      videoLinks,
      options, subQuestions,
      academicLevels, tags, sources, units, natures,
    } = req.body;

    if (!topicId || !type) {
      return res.status(400).json({ error: 'Topic ID and question type are required' });
    }

    if (!natures || !Array.isArray(natures) || natures.length === 0) {
      return res.status(400).json({ error: 'At least one nature must be selected' });
    }

    if (type === 'MCQ') {
      if (!questionText) return res.status(400).json({ error: 'Question text is required for MCQ' });
      if (!options || options.length < 2) return res.status(400).json({ error: 'MCQ must have at least 2 options' });
      if (!options.some(opt => opt.isCorrect)) return res.status(400).json({ error: 'At least one correct answer must be selected' });
    }

    if (type === 'MCQ_CLUSTER') {
      if (!stemText) return res.status(400).json({ error: 'Stem text is required for cluster MCQ' });
      if (!subQuestions || subQuestions.length === 0) return res.status(400).json({ error: 'At least one sub-question is required for cluster MCQ' });
      for (let i = 0; i < subQuestions.length; i++) {
        const sq = subQuestions[i];
        if (!sq.questionText) return res.status(400).json({ error: `Sub-question ${i + 1} must have question text` });
        if (!sq.options || sq.options.length < 2) return res.status(400).json({ error: `Sub-question ${i + 1} must have at least 2 options` });
        if (!sq.options.some(opt => opt.isCorrect)) return res.status(400).json({ error: `Sub-question ${i + 1} must have at least one correct answer` });
      }
    }

    if (type === 'WRITTEN') {
      if (!questionText && (!subQuestions || subQuestions.length === 0)) {
        return res.status(400).json({ error: 'Written question must have question text or sub-questions' });
      }
    }

    await client.query('BEGIN');

    const questionResult = await client.query(
      `INSERT INTO questions 
       (topic_id, type, difficulty_id, search_code,
        stem_text, stem_images,
        question_text, question_images,
        answer_text, answer_images,
        video_links,
        options, sub_questions,
        created_by, last_edited_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $14)
       RETURNING *`,
      [
        topicId, type, difficultyId || null,
        searchCode || null,
        stemText || null,
        stemImages ? JSON.stringify(stemImages) : null,
        questionText || null,
        questionImages ? JSON.stringify(questionImages) : null,
        answerText || null,
        answerImages ? JSON.stringify(answerImages) : null,
        videoLinks ? JSON.stringify(videoLinks) : null,
        options ? JSON.stringify(options) : null,
        subQuestions ? JSON.stringify(subQuestions) : null,
        req.admin.id,
      ]
    );

    const questionId = questionResult.rows[0].id;

    if (academicLevels && academicLevels.length > 0) {
      const levelValues = academicLevels.map((levelId) => `('${questionId}', ${levelId})`).join(',');
      await client.query(`INSERT INTO question_academic_levels (question_id, academic_level_id) VALUES ${levelValues}`);
    }

    if (tags && tags.length > 0) {
      const tagValues = tags.map((tagId) => `('${questionId}', '${tagId}')`).join(',');
      await client.query(`INSERT INTO question_tags (question_id, tag_id) VALUES ${tagValues}`);
    }

    if (units && units.length > 0) {
      const unitValues = units.map((unitId) => `('${questionId}', '${unitId}')`).join(',');
      await client.query(`INSERT INTO question_units (question_id, unit_id) VALUES ${unitValues}`);
    }

    const natureValues = natures.map((natureId) => `('${questionId}', '${natureId}')`).join(',');
    await client.query(`INSERT INTO question_natures (question_id, nature_id) VALUES ${natureValues}`);

    await insertQuestionSources(client, questionId, normalizeSources(sources));

    await client.query('COMMIT');
    const completeQuestion = await getQuestionById(questionId);
    res.status(201).json(completeQuestion);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Create question error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
};

// ============================================
// GET QUESTION BY ID (Helper) — live questions only
// ============================================
const getQuestionById = async (questionId) => {
  const result = await pool.query(
    `SELECT q.*,
            t.name as topic_name,
            ch.name as chapter_name,
            a.name as archive_name,
            d.name as difficulty_name,
            c.username as created_by_name,
            c.full_name as created_by_fullname,
            e.username as edited_by_name,
            e.full_name as edited_by_fullname,
            COALESCE(json_agg(DISTINCT jsonb_build_object('id', al.id, 'name', al.name)) FILTER (WHERE al.id IS NOT NULL), '[]') as academic_levels,
            COALESCE(json_agg(DISTINCT jsonb_build_object('id', tg.id, 'name', tg.name)) FILTER (WHERE tg.id IS NOT NULL), '[]') as tags,
            COALESCE(json_agg(DISTINCT jsonb_build_object('id', u.id, 'name', u.name)) FILTER (WHERE u.id IS NOT NULL), '[]') as units,
            COALESCE(json_agg(DISTINCT jsonb_build_object('id', n.id, 'name', n.name)) FILTER (WHERE n.id IS NOT NULL), '[]') as natures,
            COALESCE(json_agg(DISTINCT jsonb_build_object(
              'id', s.id,
              'name', s.name,
              'yearId', y.id,
              'year', y.value,
              'label', CASE WHEN y.value IS NOT NULL THEN s.name || ' (' || y.value || ')' ELSE s.name END
            )) FILTER (WHERE s.id IS NOT NULL), '[]') as sources
     FROM questions q
     LEFT JOIN topics t ON q.topic_id = t.id
     LEFT JOIN chapters ch ON t.chapter_id = ch.id
     LEFT JOIN archives a ON ch.archive_id = a.id
     LEFT JOIN difficulty_levels d ON q.difficulty_id = d.id
     LEFT JOIN admins c ON q.created_by = c.id
     LEFT JOIN admins e ON q.last_edited_by = e.id
     LEFT JOIN question_academic_levels qal ON q.id = qal.question_id
     LEFT JOIN academic_levels al ON qal.academic_level_id = al.id
     LEFT JOIN question_tags qt ON q.id = qt.question_id
     LEFT JOIN tags tg ON qt.tag_id = tg.id
     LEFT JOIN question_units qu ON q.id = qu.question_id
     LEFT JOIN units u ON qu.unit_id = u.id
     LEFT JOIN question_natures qn ON q.id = qn.question_id
     LEFT JOIN natures n ON qn.nature_id = n.id
     LEFT JOIN question_sources qs ON q.id = qs.question_id
     LEFT JOIN sources s ON qs.source_id = s.id
     LEFT JOIN years y ON qs.year_id = y.id
     WHERE q.id = $1 AND q.deleted_at IS NULL
     GROUP BY q.id, t.name, ch.name, a.name, d.name, c.username, c.full_name, e.username, e.full_name`,
    [questionId]
  );
  return result.rows[0];
};

// ============================================
// UPDATE QUESTION
// ============================================
const updateQuestion = async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const {
      topicId, type, difficultyId,
      searchCode,
      stemText, stemImages,
      questionText, questionImages,
      answerText, answerImages,
      videoLinks,
      options, subQuestions,
      academicLevels, tags, sources, units, natures,
    } = req.body;

    if (natures !== undefined && (!Array.isArray(natures) || natures.length === 0)) {
      return res.status(400).json({ error: 'At least one nature must be selected' });
    }

    await client.query('BEGIN');

    const questionResult = await client.query(
      `UPDATE questions 
       SET topic_id = COALESCE($1, topic_id),
           type = COALESCE($2, type),
           difficulty_id = $3,
           search_code = $4,
           stem_text = $5, stem_images = $6,
           question_text = $7, question_images = $8,
           answer_text = $9, answer_images = $10,
           video_links = $11,
           options = $12, sub_questions = $13,
           last_edited_by = $14,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $15 AND deleted_at IS NULL RETURNING *`,
      [
        topicId, type, difficultyId,
        searchCode ?? null,
        stemText,
        stemImages ? JSON.stringify(stemImages) : null,
        questionText,
        questionImages ? JSON.stringify(questionImages) : null,
        answerText,
        answerImages ? JSON.stringify(answerImages) : null,
        videoLinks ? JSON.stringify(videoLinks) : null,
        options ? JSON.stringify(options) : null,
        subQuestions ? JSON.stringify(subQuestions) : null,
        req.admin.id, id,
      ]
    );

    if (questionResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Question not found' });
    }

    if (academicLevels !== undefined) {
      await client.query('DELETE FROM question_academic_levels WHERE question_id = $1', [id]);
      if (academicLevels.length > 0) {
        const levelValues = academicLevels.map((levelId) => `('${id}', ${levelId})`).join(',');
        await client.query(`INSERT INTO question_academic_levels (question_id, academic_level_id) VALUES ${levelValues}`);
      }
    }

    if (tags !== undefined) {
      await client.query('DELETE FROM question_tags WHERE question_id = $1', [id]);
      if (tags.length > 0) {
        const tagValues = tags.map((tagId) => `('${id}', '${tagId}')`).join(',');
        await client.query(`INSERT INTO question_tags (question_id, tag_id) VALUES ${tagValues}`);
      }
    }

    if (units !== undefined) {
      await client.query('DELETE FROM question_units WHERE question_id = $1', [id]);
      if (units.length > 0) {
        const unitValues = units.map((unitId) => `('${id}', '${unitId}')`).join(',');
        await client.query(`INSERT INTO question_units (question_id, unit_id) VALUES ${unitValues}`);
      }
    }

    if (natures !== undefined) {
      await client.query('DELETE FROM question_natures WHERE question_id = $1', [id]);
      const natureValues = natures.map((natureId) => `('${id}', '${natureId}')`).join(',');
      await client.query(`INSERT INTO question_natures (question_id, nature_id) VALUES ${natureValues}`);
    }

    if (sources !== undefined) {
      await client.query('DELETE FROM question_sources WHERE question_id = $1', [id]);
      await insertQuestionSources(client, id, normalizeSources(sources));
    }

    await client.query('COMMIT');
    const updatedQuestion = await getQuestionById(id);
    res.json(updatedQuestion);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Update question error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
};

// ============================================
// GET ALL QUESTIONS WITH FILTERS (live only)
// ============================================
const getQuestions = async (req, res) => {
  try {
    const {
      // location (plural = new multi-select; singular = legacy fallback)
      classes, archiveIds, chapterIds, topicIds,
      archiveId, chapterId, topicId,
      // classification
      types, type,
      difficultyIds, difficultyId,
      natureIds,
      academicLevelIds, academicLevels,
      // metadata
      tagIds, unitIds, sourceIds, yearIds,
      tagId, sourceId, tags, sources,
      // text / ranges
      searchCode, keyword,
      yearFrom, yearTo,
      createdFrom, createdTo,
      // misc
      sortBy = 'newest',
      page = 1, limit = 20,
    } = req.query;

    const conditions = [];
    const params = [];
    let p = 1;

    // Always hide trashed questions
    conditions.push('q.deleted_at IS NULL');

    // ── Location ──────────────────────────────────────────────────────────────
    // NOTE: "class" is not a column on archives. In this schema a class
    // (Class 5 … HSC … Admission) is an academic_level, linked via
    // question_academic_levels. So `classes` (sent as level NAMES) is matched
    // against academic_levels.name.
    const classList = csvList(classes);
    if (classList) {
      conditions.push(`
        EXISTS (
          SELECT 1 FROM question_academic_levels qalc
          JOIN academic_levels alc ON qalc.academic_level_id = alc.id
          WHERE qalc.question_id = q.id
          AND alc.name = ANY($${p}::text[])
        )
      `);
      params.push(classList);
      p++;
    }

    const archiveList = csvList(archiveIds) || (archiveId ? [archiveId] : null);
    if (archiveList) {
      conditions.push(`a.id::text = ANY($${p}::text[])`);
      params.push(archiveList);
      p++;
    }

    const chapterList = csvList(chapterIds) || (chapterId ? [chapterId] : null);
    if (chapterList) {
      conditions.push(`ch.id::text = ANY($${p}::text[])`);
      params.push(chapterList);
      p++;
    }

    const topicList = csvList(topicIds) || (topicId ? [topicId] : null);
    if (topicList) {
      conditions.push(`t.id::text = ANY($${p}::text[])`);
      params.push(topicList);
      p++;
    }

    // ── Classification ────────────────────────────────────────────────────────
    const typeList = csvList(types) || (type ? [type] : null);
    if (typeList) {
      conditions.push(`q.type = ANY($${p}::text[])`);
      params.push(typeList);
      p++;
    }

    const difficultyList = csvList(difficultyIds) || (difficultyId ? [difficultyId] : null);
    if (difficultyList) {
      conditions.push(`q.difficulty_id::text = ANY($${p}::text[])`);
      params.push(difficultyList);
      p++;
    }

    const natureFilter = csvList(natureIds);
    if (natureFilter) {
      conditions.push(`
        EXISTS (
          SELECT 1 FROM question_natures qn
          WHERE qn.question_id = q.id
          AND qn.nature_id = ANY($${p}::uuid[])
        )
      `);
      params.push(natureFilter);
      p++;
    }

    // academic_level_id is INT (note the ::int[] cast)
    const levelFilter = csvList(academicLevelIds) || csvList(academicLevels);
    if (levelFilter) {
      conditions.push(`
        EXISTS (
          SELECT 1 FROM question_academic_levels qal
          WHERE qal.question_id = q.id
          AND qal.academic_level_id = ANY($${p}::int[])
        )
      `);
      params.push(levelFilter.map(Number));
      p++;
    }

    // ── Metadata ──────────────────────────────────────────────────────────────
    const tagFilter = csvList(tagIds) || (tagId ? [tagId] : null) || csvList(tags);
    if (tagFilter) {
      conditions.push(`
        EXISTS (
          SELECT 1 FROM question_tags qt
          WHERE qt.question_id = q.id
          AND qt.tag_id = ANY($${p}::uuid[])
        )
      `);
      params.push(tagFilter);
      p++;
    }

    const unitFilter = csvList(unitIds);
    if (unitFilter) {
      conditions.push(`
        EXISTS (
          SELECT 1 FROM question_units qu
          WHERE qu.question_id = q.id
          AND qu.unit_id = ANY($${p}::uuid[])
        )
      `);
      params.push(unitFilter);
      p++;
    }

    const sourceFilter = csvList(sourceIds) || (sourceId ? [sourceId] : null) || csvList(sources);
    if (sourceFilter) {
      conditions.push(`
        EXISTS (
          SELECT 1 FROM question_sources qs
          WHERE qs.question_id = q.id
          AND qs.source_id = ANY($${p}::uuid[])
        )
      `);
      params.push(sourceFilter);
      p++;
    }

    const yearFilter = csvList(yearIds);
    if (yearFilter) {
      conditions.push(`
        EXISTS (
          SELECT 1 FROM question_sources qsy
          WHERE qsy.question_id = q.id
          AND qsy.year_id = ANY($${p}::uuid[])
        )
      `);
      params.push(yearFilter);
      p++;
    }

    // ── Text / ranges ─────────────────────────────────────────────────────────
    if (searchCode) {
      conditions.push(`q.search_code ILIKE $${p++}`);
      params.push(`%${searchCode}%`);
    }

    if (keyword) {
      conditions.push(`(
        q.question_text ILIKE $${p}
        OR q.stem_text ILIKE $${p}
        OR q.answer_text ILIKE $${p}
        OR q.search_code ILIKE $${p}
        OR EXISTS (
          SELECT 1
          FROM question_sources qsk
          JOIN sources sk ON qsk.source_id = sk.id
          LEFT JOIN years yk ON qsk.year_id = yk.id
          WHERE qsk.question_id = q.id
          AND (
            sk.name ILIKE $${p}
            OR CAST(yk.value AS TEXT) ILIKE $${p}
          )
        )
      )`);
      params.push(`%${keyword}%`);
      p++;
    }

    if (yearFrom) {
      conditions.push(`
        EXISTS (
          SELECT 1
          FROM question_sources qs2
          JOIN years yr2 ON qs2.year_id = yr2.id
          WHERE qs2.question_id = q.id
          AND yr2.value >= $${p}
        )
      `);
      params.push(parseInt(yearFrom, 10));
      p++;
    }

    if (yearTo) {
      conditions.push(`
        EXISTS (
          SELECT 1
          FROM question_sources qs3
          JOIN years yr3 ON qs3.year_id = yr3.id
          WHERE qs3.question_id = q.id
          AND yr3.value <= $${p}
        )
      `);
      params.push(parseInt(yearTo, 10));
      p++;
    }

    // Upload date range (created_at). End date is inclusive of the whole day.
    if (createdFrom) {
      conditions.push(`q.created_at >= $${p}::date`);
      params.push(createdFrom);
      p++;
    }

    if (createdTo) {
      conditions.push(`q.created_at < ($${p}::date + INTERVAL '1 day')`);
      params.push(createdTo);
      p++;
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const baseFrom = `
      FROM questions q
      JOIN topics t ON q.topic_id = t.id
      JOIN chapters ch ON t.chapter_id = ch.id
      JOIN archives a ON ch.archive_id = a.id
      LEFT JOIN difficulty_levels d ON q.difficulty_id = d.id
      LEFT JOIN admins creator ON q.created_by = creator.id
      LEFT JOIN admins editor ON q.last_edited_by = editor.id
    `;

    const countResult = await pool.query(
      `SELECT COUNT(DISTINCT q.id) as count ${baseFrom} ${whereClause}`,
      params
    );

    const total = parseInt(countResult.rows[0].count, 10);
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    let orderBy = `q.created_at DESC`;
    if (sortBy === 'oldest') orderBy = `q.created_at ASC`;
    if (sortBy === 'updated_desc') orderBy = `q.updated_at DESC NULLS LAST`;
    if (sortBy === 'updated_asc') orderBy = `q.updated_at ASC NULLS LAST`;
    if (sortBy === 'year_desc') orderBy = `max_year DESC NULLS LAST, q.created_at DESC`;
    if (sortBy === 'year_asc') orderBy = `max_year ASC NULLS LAST, q.created_at DESC`;
    if (sortBy === 'source_az') orderBy = `first_source ASC NULLS LAST, q.created_at DESC`;
    if (sortBy === 'source_za') orderBy = `first_source DESC NULLS LAST, q.created_at DESC`;
    if (sortBy === 'unit_az') orderBy = `first_unit ASC NULLS LAST, q.created_at DESC`;
    if (sortBy === 'unit_za') orderBy = `first_unit DESC NULLS LAST, q.created_at DESC`;

    const dataResult = await pool.query(
      `SELECT q.*,
              t.name as topic_name,
              ch.name as chapter_name,
              a.name as archive_name,
              d.name as difficulty_name,
              creator.username as created_by_name,
              creator.full_name as created_by_fullname,
              editor.username as edited_by_name,
              editor.full_name as edited_by_fullname,

              source_data.sources,
              source_data.max_year,
              source_data.first_source,
              unit_data.first_unit,

              COALESCE(tag_data.tags, '[]') as tags,
              COALESCE(unit_data.units, '[]') as units,
              COALESCE(nature_data.natures, '[]') as natures,
              COALESCE(level_data.academic_levels, '[]') as academic_levels

       ${baseFrom}

       LEFT JOIN LATERAL (
          SELECT
            COALESCE(
              json_agg(
                jsonb_build_object(
                  'sourceId', s.id,
                  'source_id', s.id,
                  'id', s.id,
                  'sourceName', s.name,
                  'source_name', s.name,
                  'name', s.name,
                  'yearId', y.id,
                  'year_id', y.id,
                  'yearValue', y.value,
                  'year_value', y.value,
                  'year', y.value,
                  'label',
                    CASE
                      WHEN y.value IS NOT NULL THEN s.name || ' (' || y.value || ')'
                      ELSE s.name
                    END,
                  'source_label',
                    CASE
                      WHEN y.value IS NOT NULL THEN s.name || ' (' || y.value || ')'
                      ELSE s.name
                    END
                )
                ORDER BY y.value DESC NULLS LAST, s.name ASC
              ) FILTER (WHERE s.id IS NOT NULL),
              '[]'
            ) as sources,
            MAX(y.value) as max_year,
            MIN(s.name) as first_source
          FROM question_sources qs
          JOIN sources s ON qs.source_id = s.id
          LEFT JOIN years y ON qs.year_id = y.id
          WHERE qs.question_id = q.id
       ) source_data ON true

       LEFT JOIN LATERAL (
          SELECT COALESCE(
            json_agg(DISTINCT jsonb_build_object('id', tg.id, 'name', tg.name))
            FILTER (WHERE tg.id IS NOT NULL),
            '[]'
          ) as tags
          FROM question_tags qt
          JOIN tags tg ON qt.tag_id = tg.id
          WHERE qt.question_id = q.id
       ) tag_data ON true

       LEFT JOIN LATERAL (
          SELECT
            COALESCE(
              json_agg(DISTINCT jsonb_build_object('id', u.id, 'name', u.name))
              FILTER (WHERE u.id IS NOT NULL),
              '[]'
            ) as units,
            MIN(u.name) as first_unit
          FROM question_units qu
          JOIN units u ON qu.unit_id = u.id
          WHERE qu.question_id = q.id
       ) unit_data ON true

       LEFT JOIN LATERAL (
          SELECT COALESCE(
            json_agg(DISTINCT jsonb_build_object('id', n.id, 'name', n.name))
            FILTER (WHERE n.id IS NOT NULL),
            '[]'
          ) as natures
          FROM question_natures qn
          JOIN natures n ON qn.nature_id = n.id
          WHERE qn.question_id = q.id
       ) nature_data ON true

       LEFT JOIN LATERAL (
          SELECT COALESCE(
            json_agg(DISTINCT jsonb_build_object('id', al.id, 'name', al.name))
            FILTER (WHERE al.id IS NOT NULL),
            '[]'
          ) as academic_levels
          FROM question_academic_levels qal
          JOIN academic_levels al ON qal.academic_level_id = al.id
          WHERE qal.question_id = q.id
       ) level_data ON true

       ${whereClause}
       ORDER BY ${orderBy}
       LIMIT $${p} OFFSET $${p + 1}`,
      [...params, parseInt(limit, 10), offset]
    );

    res.json({
      questions: dataResult.rows,
      pagination: {
        total,
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        totalPages: Math.ceil(total / parseInt(limit, 10)),
      },
    });
  } catch (error) {
    console.error('Get questions error:', error);
    res.status(500).json({ error: error.message });
  }
};

// ============================================
// GET SINGLE QUESTION (live only)
// ============================================
const getSingleQuestion = async (req, res) => {
  try {
    const { id } = req.params;
    const question = await getQuestionById(id);
    if (!question) return res.status(404).json({ error: 'Question not found' });
    res.json(question);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// ============================================
// MOVE QUESTION (live only)
// ============================================
const moveQuestion = async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { targetTopicId } = req.body;
    if (!targetTopicId) return res.status(400).json({ error: 'Target topic ID is required' });

    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE questions SET topic_id = $1, last_edited_by = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $3 AND deleted_at IS NULL RETURNING *`,
      [targetTopicId, req.admin.id, id]
    );
    if (result.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Question not found' }); }
    await client.query('COMMIT');
    res.json(await getQuestionById(id));
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
};

// ============================================
// COPY QUESTION (live only). search_code is NOT copied -> copy starts blank.
// ============================================
const copyQuestion = async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { targetTopicId } = req.body;
    if (!targetTopicId) return res.status(400).json({ error: 'Target topic ID is required' });

    await client.query('BEGIN');
    const original = await client.query('SELECT * FROM questions WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (original.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Question not found' }); }

    const q = original.rows[0];
    const copy = await client.query(
      `INSERT INTO questions (topic_id, type, difficulty_id, search_code, stem_text, stem_images, question_text, question_images, answer_text, answer_images, video_links, options, sub_questions, created_by, last_edited_by)
       VALUES ($1, $2, $3, NULL, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13) RETURNING *`,
      [targetTopicId, q.type, q.difficulty_id, q.stem_text, q.stem_images, q.question_text, q.question_images, q.answer_text, q.answer_images, q.video_links, q.options, q.sub_questions, req.admin.id]
    );

    const newId = copy.rows[0].id;
    await client.query(`INSERT INTO question_academic_levels (question_id, academic_level_id) SELECT $1, academic_level_id FROM question_academic_levels WHERE question_id = $2`, [newId, id]);
    await client.query(`INSERT INTO question_tags (question_id, tag_id) SELECT $1, tag_id FROM question_tags WHERE question_id = $2`, [newId, id]);
    await client.query(`INSERT INTO question_units (question_id, unit_id) SELECT $1, unit_id FROM question_units WHERE question_id = $2`, [newId, id]);
    await client.query(`INSERT INTO question_natures (question_id, nature_id) SELECT $1, nature_id FROM question_natures WHERE question_id = $2`, [newId, id]);
    await client.query(`INSERT INTO question_sources (question_id, source_id, year_id) SELECT $1, source_id, year_id FROM question_sources WHERE question_id = $2`, [newId, id]);

    await client.query('COMMIT');
    res.status(201).json(await getQuestionById(newId));
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Copy question error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
};

// ============================================
// SOFT DELETE QUESTION (admins + super admins) -> moves to trash.
// search_code freed immediately via the partial unique index.
// ============================================
const deleteQuestion = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `UPDATE questions
         SET deleted_at = CURRENT_TIMESTAMP, deleted_by = $2
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING id`,
      [id, req.admin.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Question not found' });
    res.json({ message: 'Question moved to trash' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// ============================================
// LIST TRASH (super admin only)
// ============================================
const listTrash = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT q.id, q.type, q.search_code, q.question_text, q.stem_text, q.deleted_at,
              t.name as topic_name, ch.name as chapter_name, a.name as archive_name,
              db.username as deleted_by_name, db.full_name as deleted_by_fullname
       FROM questions q
       LEFT JOIN topics t ON q.topic_id = t.id
       LEFT JOIN chapters ch ON t.chapter_id = ch.id
       LEFT JOIN archives a ON ch.archive_id = a.id
       LEFT JOIN admins db ON q.deleted_by = db.id
       WHERE q.deleted_at IS NOT NULL
       ORDER BY q.deleted_at DESC
       LIMIT 500`
    );
    res.json({ questions: result.rows });
  } catch (error) {
    console.error('List trash error:', error.message);
    res.status(500).json({ error: error.message });
  }
};

// ============================================
// RESTORE QUESTION (super admin only)
// If the code was reused by a live question meanwhile, clear it on restore.
// ============================================
const restoreQuestion = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `UPDATE questions q
         SET deleted_at = NULL,
             deleted_by = NULL,
             search_code = CASE
               WHEN q.search_code IS NOT NULL AND EXISTS (
                 SELECT 1 FROM questions q2
                 WHERE q2.id <> q.id AND q2.deleted_at IS NULL AND q2.search_code = q.search_code
               ) THEN NULL
               ELSE q.search_code
             END
       WHERE q.id = $1 AND q.deleted_at IS NOT NULL
       RETURNING id`,
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Trashed question not found' });
    res.json({ message: 'Question restored', id: result.rows[0].id });
  } catch (error) {
    console.error('Restore question error:', error.message);
    res.status(500).json({ error: error.message });
  }
};

// ============================================
// PERMANENT DELETE (super admin only) — only items already in trash
// ============================================
const permanentDeleteQuestion = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'DELETE FROM questions WHERE id = $1 AND deleted_at IS NOT NULL RETURNING id',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Trashed question not found (only trashed items can be permanently deleted)' });
    }
    res.json({ message: 'Question permanently deleted' });
  } catch (error) {
    console.error('Permanent delete error:', error.message);
    res.status(500).json({ error: error.message });
  }
};

export {
  createQuestion, getQuestions, getSingleQuestion, updateQuestion,
  moveQuestion, copyQuestion, deleteQuestion,
  listTrash, restoreQuestion, permanentDeleteQuestion,
};