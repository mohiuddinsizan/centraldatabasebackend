import jwt from 'jsonwebtoken';
import pool from '../config/database.js';

/**
 * Role guard. Use AFTER authenticateAdmin on a route:
 *   router.post('/', authenticateAdmin, requireRole('admin', 'uploader'), handler);
 *
 * Hierarchy: super_admin > admin > uploader.
 * A super_admin passes EVERY requireRole check automatically, so you never need
 * to list 'super_admin' in a route — it's implied. Use requireRole('super_admin')
 * only when you want something exclusive to super admins.
 *
 * It reads the role from the JWT (baked in at login). If the token predates the
 * role change, it falls back to a fresh DB lookup so nobody gets locked out.
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

    // super_admin bypasses every check; otherwise the role must be in the allow-list.
    const allowed = role === 'super_admin' || (role && allowedRoles.includes(role));
    if (!allowed) {
      return res.status(403).json({ error: 'Forbidden: insufficient permissions' });
    }

    req.adminRole = role;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};