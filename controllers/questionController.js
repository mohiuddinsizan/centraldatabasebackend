import pool from '../config/database.js';

// ============================================
// HELPERS
// ============================================

// Normalize the `sources` payload into a uniform [{ sourceId, yearId }] shape.
// Accepts either:
//   - plain string UUIDs (legacy):        ["uuid1", "uuid2"]
//   - objects with optional year:         [{ sourceId: "uuid1", yearId: "uuidY" }, { sourceId: "uuid2" }]
// yearId is optional; null means "this source is not tied to a year".
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

// ============================================
// CREATE QUESTION
// ============================================
const createQuestion = async (req, res) => {
  const client = await pool.connect();
  try {
    const {
      topicId, type, difficultyId,
      stemText, stemImages,
      questionText, questionImages,
      answerText, answerImages,
      videoLinks,
      options, subQuestions,
      academicLevels, tags, sources, units,
    } = req.body;

    if (!topicId || !type) {
      return res.status(400).json({ error: 'Topic ID and question type are required' });
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
       (topic_id, type, difficulty_id, 
        stem_text, stem_images,
        question_text, question_images,
        answer_text, answer_images,
        video_links,
        options, sub_questions,
        created_by, last_edited_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)
       RETURNING *`,
      [
        topicId, type, difficultyId || null,
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
// GET QUESTION BY ID (Helper)
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
     LEFT JOIN question_sources qs ON q.id = qs.question_id
     LEFT JOIN sources s ON qs.source_id = s.id
     LEFT JOIN years y ON qs.year_id = y.id
     WHERE q.id = $1
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
      stemText, stemImages,
      questionText, questionImages,
      answerText, answerImages,
      videoLinks,
      options, subQuestions,
      academicLevels, tags, sources, units,
    } = req.body;

    await client.query('BEGIN');

    const questionResult = await client.query(
      `UPDATE questions 
       SET topic_id = COALESCE($1, topic_id),
           type = COALESCE($2, type),
           difficulty_id = $3,
           stem_text = $4, stem_images = $5,
           question_text = $6, question_images = $7,
           answer_text = $8, answer_images = $9,
           video_links = $10,
           options = $11, sub_questions = $12,
           last_edited_by = $13,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $14 RETURNING *`,
      [
        topicId, type, difficultyId,
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
// GET ALL QUESTIONS WITH FILTERS
// Multi-value: tagIds, sourceIds, unitIds, yearIds (comma-separated)
// Year range: yearFrom / yearTo
// ============================================
const getQuestions = async (req, res) => {
  try {
    const {
      archiveId, chapterId, topicId,
      academicLevels, difficultyId, keyword, type,
      tagIds, sourceIds, unitIds, yearIds,
      tagId, sourceId, tags, sources,
      yearFrom, yearTo,
      sortBy = 'newest',
      page = 1, limit = 20,
    } = req.query;

    const conditions = [];
    const params = [];
    let p = 1;

    if (archiveId) {
      conditions.push(`a.id = $${p++}`);
      params.push(archiveId);
    }

    if (chapterId) {
      conditions.push(`ch.id = $${p++}`);
      params.push(chapterId);
    }

    if (topicId) {
      conditions.push(`t.id = $${p++}`);
      params.push(topicId);
    }

    if (difficultyId) {
      conditions.push(`q.difficulty_id = $${p++}`);
      params.push(difficultyId);
    }

    if (type) {
      conditions.push(`q.type = $${p++}`);
      params.push(type);
    }

    if (keyword) {
      conditions.push(`(
        q.question_text ILIKE $${p}
        OR q.stem_text ILIKE $${p}
        OR q.answer_text ILIKE $${p}
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

    if (academicLevels) {
      conditions.push(`
        EXISTS (
          SELECT 1
          FROM question_academic_levels qal
          WHERE qal.question_id = q.id
          AND qal.academic_level_id = ANY($${p}::int[])
        )
      `);
      params.push(academicLevels.split(',').map(Number));
      p++;
    }

    const tagFilter = tagIds
      ? tagIds.split(',').filter(Boolean)
      : tagId
        ? [tagId]
        : tags
          ? tags.split(',').filter(Boolean)
          : null;

    if (tagFilter && tagFilter.length > 0) {
      conditions.push(`
        EXISTS (
          SELECT 1
          FROM question_tags qt
          WHERE qt.question_id = q.id
          AND qt.tag_id = ANY($${p}::uuid[])
        )
      `);
      params.push(tagFilter);
      p++;
    }

    const unitFilter = unitIds ? unitIds.split(',').filter(Boolean) : null;

    if (unitFilter && unitFilter.length > 0) {
      conditions.push(`
        EXISTS (
          SELECT 1
          FROM question_units qu
          WHERE qu.question_id = q.id
          AND qu.unit_id = ANY($${p}::uuid[])
        )
      `);
      params.push(unitFilter);
      p++;
    }

    const sourceFilter = sourceIds
      ? sourceIds.split(',').filter(Boolean)
      : sourceId
        ? [sourceId]
        : sources
          ? sources.split(',').filter(Boolean)
          : null;

    if (sourceFilter && sourceFilter.length > 0) {
      conditions.push(`
        EXISTS (
          SELECT 1
          FROM question_sources qs
          WHERE qs.question_id = q.id
          AND qs.source_id = ANY($${p}::uuid[])
        )
      `);
      params.push(sourceFilter);
      p++;
    }

    const yearFilter = yearIds ? yearIds.split(',').filter(Boolean) : null;

    if (yearFilter && yearFilter.length > 0) {
      conditions.push(`
        EXISTS (
          SELECT 1
          FROM question_sources qsy
          WHERE qsy.question_id = q.id
          AND qsy.year_id = ANY($${p}::uuid[])
        )
      `);
      params.push(yearFilter);
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

    const whereClause = conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

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

    if (sortBy === 'oldest') {
      orderBy = `q.created_at ASC`;
    }

    if (sortBy === 'updated_desc') {
      orderBy = `q.updated_at DESC NULLS LAST`;
    }

    if (sortBy === 'updated_asc') {
      orderBy = `q.updated_at ASC NULLS LAST`;
    }

    if (sortBy === 'year_desc') {
      orderBy = `max_year DESC NULLS LAST, q.created_at DESC`;
    }

    if (sortBy === 'year_asc') {
      orderBy = `max_year ASC NULLS LAST, q.created_at DESC`;
    }

    if (sortBy === 'source_az') {
      orderBy = `first_source ASC NULLS LAST, q.created_at DESC`;
    }

    if (sortBy === 'source_za') {
      orderBy = `first_source DESC NULLS LAST, q.created_at DESC`;
    }

    if (sortBy === 'unit_az') {
      orderBy = `first_unit ASC NULLS LAST, q.created_at DESC`;
    }

    if (sortBy === 'unit_za') {
      orderBy = `first_unit DESC NULLS LAST, q.created_at DESC`;
    }

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
// GET SINGLE QUESTION
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
// MOVE QUESTION
// ============================================
const moveQuestion = async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { targetTopicId } = req.body;
    if (!targetTopicId) return res.status(400).json({ error: 'Target topic ID is required' });

    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE questions SET topic_id = $1, last_edited_by = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3 RETURNING *`,
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
// COPY QUESTION
// ============================================
const copyQuestion = async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { targetTopicId } = req.body;
    if (!targetTopicId) return res.status(400).json({ error: 'Target topic ID is required' });

    await client.query('BEGIN');
    const original = await client.query('SELECT * FROM questions WHERE id = $1', [id]);
    if (original.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Question not found' }); }

    const q = original.rows[0];
    const copy = await client.query(
      `INSERT INTO questions (topic_id, type, difficulty_id, stem_text, stem_images, question_text, question_images, answer_text, answer_images, video_links, options, sub_questions, created_by, last_edited_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13) RETURNING *`,
      [targetTopicId, q.type, q.difficulty_id, q.stem_text, q.stem_images, q.question_text, q.question_images, q.answer_text, q.answer_images, q.video_links, q.options, q.sub_questions, req.admin.id]
    );

    const newId = copy.rows[0].id;
    await client.query(`INSERT INTO question_academic_levels (question_id, academic_level_id) SELECT $1, academic_level_id FROM question_academic_levels WHERE question_id = $2`, [newId, id]);
    await client.query(`INSERT INTO question_tags (question_id, tag_id) SELECT $1, tag_id FROM question_tags WHERE question_id = $2`, [newId, id]);
    await client.query(`INSERT INTO question_units (question_id, unit_id) SELECT $1, unit_id FROM question_units WHERE question_id = $2`, [newId, id]);
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
// DELETE QUESTION
// ============================================
const deleteQuestion = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM questions WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Question not found' });
    res.json({ message: 'Question deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export { createQuestion, getQuestions, getSingleQuestion, updateQuestion, moveQuestion, copyQuestion, deleteQuestion };