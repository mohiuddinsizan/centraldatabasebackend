import express from 'express';
import {
  login, getStats, listUsers, createUser, resetUserPassword,
} from '../controllers/adminController.js';
import { authenticateAdmin } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';

const router = express.Router();

router.post('/login', login);

// Dashboard stats — admins (and super admins) only
router.get('/stats', authenticateAdmin, requireRole('admin'), getStats);

// User management — super admin only
router.get('/users',                 authenticateAdmin, requireRole('super_admin'), listUsers);
router.post('/users',                authenticateAdmin, requireRole('super_admin'), createUser);
router.patch('/users/:id/password',  authenticateAdmin, requireRole('super_admin'), resetUserPassword);

export default router;