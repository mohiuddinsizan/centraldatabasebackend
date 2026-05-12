import express from 'express';
import { authenticateAdmin } from '../middleware/auth.js';
import { getAnalytics } from '../controllers/analyticsController.js';

const router = express.Router();

router.get('/', authenticateAdmin, getAnalytics);

export default router;