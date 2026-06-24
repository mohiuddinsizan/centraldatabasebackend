import express from 'express';
import { authenticateAdmin } from '../middleware/auth.js';
import { getNatures } from '../controllers/naturesController.js';

const router = express.Router();

router.get('/', authenticateAdmin, getNatures);

export default router;