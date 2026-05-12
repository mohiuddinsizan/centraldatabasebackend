import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../config/database.js';

const login = async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const result = await pool.query(
      'SELECT * FROM admins WHERE username = $1',
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const admin = result.rows[0];
    const isValidPassword = await bcrypt.compare(password, admin.password_hash);

    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { adminId: admin.id },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE }
    );

    res.json({
      token,
      admin: {
        id: admin.id,
        username: admin.username,
        email: admin.email,
        full_name: admin.full_name,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getStats = async (req, res) => {
  try {
    const [
      archivesResult,
      questionsResult,
      adminsResult,
      questionsByTypeResult,
      questionsByDifficultyResult,
      recentQuestionsResult,
      archivesWithCountResult,
    ] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM archives'),
      pool.query('SELECT COUNT(*) FROM questions'),
      pool.query('SELECT COUNT(*) FROM admins'),
      pool.query(`
        SELECT type, COUNT(*) as count
        FROM questions
        GROUP BY type
        ORDER BY count DESC
      `),
      pool.query(`
        SELECT d.name as difficulty, COUNT(q.id) as count
        FROM difficulty_levels d
        LEFT JOIN questions q ON q.difficulty_id = d.id
        GROUP BY d.id, d.name
        ORDER BY d.name
      `),
      pool.query(`
        SELECT q.id, q.type, q.created_at,
               a.name as archive_name
        FROM questions q
        LEFT JOIN topics t ON q.topic_id = t.id
        LEFT JOIN chapters ch ON t.chapter_id = ch.id
        LEFT JOIN archives a ON ch.archive_id = a.id
        ORDER BY q.created_at DESC
        LIMIT 5
      `),
      pool.query(`
        SELECT a.id, a.name,
               COUNT(q.id) as question_count
        FROM archives a
        LEFT JOIN chapters ch ON ch.archive_id = a.id
        LEFT JOIN topics t ON t.chapter_id = ch.id
        LEFT JOIN questions q ON q.topic_id = t.id
        GROUP BY a.id, a.name
        ORDER BY question_count DESC
        LIMIT 10
      `),
    ]);

    res.json({
      totals: {
        archives: parseInt(archivesResult.rows[0].count),
        questions: parseInt(questionsResult.rows[0].count),
        admins: parseInt(adminsResult.rows[0].count),
      },
      questionsByType: questionsByTypeResult.rows.map((r) => ({
        type: r.type,
        count: parseInt(r.count),
      })),
      questionsByDifficulty: questionsByDifficultyResult.rows.map((r) => ({
        difficulty: r.difficulty,
        count: parseInt(r.count),
      })),
      recentQuestions: recentQuestionsResult.rows,
      topArchives: archivesWithCountResult.rows.map((r) => ({
        id: r.id,
        name: r.name,
        questionCount: parseInt(r.question_count),
      })),
    });
  } catch (error) {
    console.error('Stats error:', error.message);
    res.status(500).json({ error: error.message });
  }
};

export { login, getStats };