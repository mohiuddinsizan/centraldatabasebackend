import express from 'express';
import { login, getStats } from '../controllers/adminController.js';
import { authenticateAdmin } from '../middleware/auth.js';

const router = express.Router();

router.post('/login', login);
router.get('/stats', authenticateAdmin, getStats);

export default router;