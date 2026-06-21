import jwt from 'jsonwebtoken';
import pool from '../config/database.js';

/**
 * Role guard. Use AFTER authenticateAdmin on a route:
 *   router.post('/', authenticateAdmin, requireRole('admin', 'uploader'), handler);
 *
 * It reads the role from the JWT (baked in at login). If the token predates
 * the role change, it falls back to a fresh DB lookup so nobody gets locked out.
 */
export const requireRole = (...allowedRoles) => async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    let role = decoded.role;
    if (!role && decoded.adminId) {
      const r = await pool.query('SELECT role FROM admins WHERE id = $1', [decoded.adminId]);
      role = r.rows[0]?.role;
    }

    if (!role || !allowedRoles.includes(role)) {
      return res.status(403).json({ error: 'Forbidden: insufficient permissions' });
    }

    req.adminRole = role;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};