import express from 'express';
import { login, getStats } from '../controllers/adminController.js';
import { authenticateAdmin } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';

const router = express.Router();

router.post('/login', login);

// Dashboard stats — admins only (uploaders don't see the dashboard)
router.get('/stats', authenticateAdmin, requireRole('admin'), getStats);

export default router;