import pool from '../config/database.js';

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
      options, subQuestions,
      academicLevels, tags, sources,
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
        options, sub_questions,
        created_by, last_edited_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)
       RETURNING *`,
      [
        topicId, type, difficultyId || null,
        stemText || null,
        stemImages ? JSON.stringify(stemImages) : null,
        questionText || null,
        questionImages ? JSON.stringify(questionImages) : null,
        answerText || null,
        answerImages ? JSON.stringify(answerImages) : null,
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

    if (sources && sources.length > 0) {
      const sourceValues = sources.map((sourceId) => `('${questionId}', '${sourceId}')`).join(',');
      await client.query(`INSERT INTO question_sources (question_id, source_id) VALUES ${sourceValues}`);
    }

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
            COALESCE(json_agg(DISTINCT jsonb_build_object('id', s.id, 'name', s.name, 'type', s.type, 'year', s.year)) FILTER (WHERE s.id IS NOT NULL), '[]') as sources
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
     LEFT JOIN question_sources qs ON q.id = qs.question_id
     LEFT JOIN sources s ON qs.source_id = s.id
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
      options, subQuestions,
      academicLevels, tags, sources,
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
           options = $10, sub_questions = $11,
           last_edited_by = $12,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $13 RETURNING *`,
      [
        topicId, type, difficultyId,
        stemText,
        stemImages ? JSON.stringify(stemImages) : null,
        questionText,
        questionImages ? JSON.stringify(questionImages) : null,
        answerText,
        answerImages ? JSON.stringify(answerImages) : null,
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

    if (sources !== undefined) {
      await client.query('DELETE FROM question_sources WHERE question_id = $1', [id]);
      if (sources.length > 0) {
        const sourceValues = sources.map((sourceId) => `('${id}', '${sourceId}')`).join(',');
        await client.query(`INSERT INTO question_sources (question_id, source_id) VALUES ${sourceValues}`);
      }
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
// Supports multi-value: tagIds (comma), sourceIds (comma), year range (yearFrom/yearTo)
// ============================================
const getQuestions = async (req, res) => {
  try {
    const {
      archiveId, chapterId, topicId,
      academicLevels, difficultyId, keyword, type,
      // Multi-select: comma-separated UUIDs
      tagIds, sourceIds,
      // Legacy single-value (kept for backwards compat)
      tagId, sourceId, tags, sources,
      // Year range
      yearFrom, yearTo,
      page = 1, limit = 20,
    } = req.query;

    const conditions = [];
    const params = [];
    let p = 1;

    if (archiveId)    { conditions.push(`a.id = $${p++}`);            params.push(archiveId); }
    if (chapterId)    { conditions.push(`ch.id = $${p++}`);           params.push(chapterId); }
    if (topicId)      { conditions.push(`t.id = $${p++}`);            params.push(topicId); }
    if (difficultyId) { conditions.push(`q.difficulty_id = $${p++}`); params.push(difficultyId); }
    if (type)         { conditions.push(`q.type = $${p++}`);          params.push(type); }

    if (keyword) {
      conditions.push(`(q.question_text ILIKE $${p} OR q.stem_text ILIKE $${p} OR q.answer_text ILIKE $${p})`);
      params.push(`%${keyword}%`);
      p++;
    }

    if (academicLevels) {
      conditions.push(`EXISTS (SELECT 1 FROM question_academic_levels qal WHERE qal.question_id = q.id AND qal.academic_level_id = ANY($${p}::int[]))`);
      params.push(academicLevels.split(',').map(Number));
      p++;
    }

    // Tag filter — multi-select takes priority, fallback to single
    const tagFilter = tagIds
      ? tagIds.split(',').filter(Boolean)
      : tagId
        ? [tagId]
        : tags
          ? tags.split(',').filter(Boolean)
          : null;
    if (tagFilter && tagFilter.length > 0) {
      conditions.push(`EXISTS (SELECT 1 FROM question_tags qt WHERE qt.question_id = q.id AND qt.tag_id = ANY($${p}::uuid[]))`);
      params.push(tagFilter);
      p++;
    }

    // Source filter — multi-select takes priority, fallback to single
    const sourceFilter = sourceIds
      ? sourceIds.split(',').filter(Boolean)
      : sourceId
        ? [sourceId]
        : sources
          ? sources.split(',').filter(Boolean)
          : null;
    if (sourceFilter && sourceFilter.length > 0) {
      conditions.push(`EXISTS (SELECT 1 FROM question_sources qs WHERE qs.question_id = q.id AND qs.source_id = ANY($${p}::uuid[]))`);
      params.push(sourceFilter);
      p++;
    }

    // Year range filter through sources
    if (yearFrom) {
      conditions.push(`EXISTS (
        SELECT 1 FROM question_sources qs2
        JOIN sources src ON qs2.source_id = src.id
        WHERE qs2.question_id = q.id AND src.year >= $${p}
      )`);
      params.push(parseInt(yearFrom));
      p++;
    }
    if (yearTo) {
      conditions.push(`EXISTS (
        SELECT 1 FROM question_sources qs3
        JOIN sources src ON qs3.source_id = src.id
        WHERE qs3.question_id = q.id AND src.year <= $${p}
      )`);
      params.push(parseInt(yearTo));
      p++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

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
    const total = parseInt(countResult.rows[0].count);

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const dataResult = await pool.query(
      `SELECT DISTINCT q.*,
              t.name as topic_name,
              ch.name as chapter_name,
              a.name as archive_name,
              d.name as difficulty_name,
              creator.username as created_by_name,
              creator.full_name as created_by_fullname,
              editor.username as edited_by_name,
              editor.full_name as edited_by_fullname
       ${baseFrom} ${whereClause}
       ORDER BY q.created_at DESC
       LIMIT $${p} OFFSET $${p + 1}`,
      [...params, limit, offset]
    );

    res.json({
      questions: dataResult.rows,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
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
      `INSERT INTO questions (topic_id, type, difficulty_id, stem_text, stem_images, question_text, question_images, answer_text, answer_images, options, sub_questions, created_by, last_edited_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12) RETURNING *`,
      [targetTopicId, q.type, q.difficulty_id, q.stem_text, q.stem_images, q.question_text, q.question_images, q.answer_text, q.answer_images, q.options, q.sub_questions, req.admin.id]
    );

    const newId = copy.rows[0].id;
    await client.query(`INSERT INTO question_academic_levels (question_id, academic_level_id) SELECT $1, academic_level_id FROM question_academic_levels WHERE question_id = $2`, [newId, id]);
    await client.query(`INSERT INTO question_tags (question_id, tag_id) SELECT $1, tag_id FROM question_tags WHERE question_id = $2`, [newId, id]);
    await client.query(`INSERT INTO question_sources (question_id, source_id) SELECT $1, source_id FROM question_sources WHERE question_id = $2`, [newId, id]);

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