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
      { adminId: admin.id, role: admin.role }, // role baked into token
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
        role: admin.role, // frontend uses this to show the right pages
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// ── List all accounts (super admin only — guarded at the route) ──────────────
const listUsers = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, username, email, full_name, role, created_at
       FROM admins
       ORDER BY
         CASE role WHEN 'super_admin' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
         created_at ASC`
    );
    res.json({ users: result.rows });
  } catch (error) {
    console.error('List users error:', error.message);
    res.status(500).json({ error: 'Failed to load users' });
  }
};

// ── Create an admin or uploader (super admin only — guarded at the route) ────
// super_admin can NOT be created here; that role exists only via the CLI.
const createUser = async (req, res) => {
  try {
    const { username, email, password, full_name, role } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Username, email and password are required' });
    }
    if (!['admin', 'uploader'].includes(role)) {
      return res.status(400).json({ error: "Role must be 'admin' or 'uploader'" });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const exists = await pool.query(
      'SELECT id FROM admins WHERE username = $1 OR email = $2',
      [username, email]
    );
    if (exists.rows.length > 0) {
      return res.status(409).json({ error: 'An account with that username or email already exists' });
    }

    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO admins (username, email, password_hash, full_name, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, username, email, full_name, role, created_at`,
      [username, email, hash, full_name || null, role]
    );

    res.status(201).json({ user: result.rows[0] });
  } catch (error) {
    console.error('Create user error:', error.message);
    res.status(500).json({ error: 'Failed to create user' });
  }
};

// ── Reset any account's password (super admin only — guarded at the route) ───
// We never reveal existing passwords (they're one-way hashed). This only SETS
// a new password chosen by the super admin.
const resetUserPassword = async (req, res) => {
  try {
    const { id } = req.params;
    const { password } = req.body;

    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const found = await pool.query('SELECT id, username FROM admins WHERE id = $1', [id]);
    if (found.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const hash = await bcrypt.hash(password, 12);
    await pool.query('UPDATE admins SET password_hash = $1 WHERE id = $2', [hash, id]);

    res.json({ message: 'Password updated', username: found.rows[0].username });
  } catch (error) {
    console.error('Reset password error:', error.message);
    res.status(500).json({ error: 'Failed to update password' });
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
      pool.query("SELECT COUNT(*) FROM admins WHERE role IN ('admin', 'super_admin')"),
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

export { login, getStats, listUsers, createUser, resetUserPassword };