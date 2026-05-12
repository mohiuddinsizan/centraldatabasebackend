import express from 'express';
import { authenticateAdmin } from '../middleware/auth.js';
import {
  createDifficulty,
  getAllDifficulties,
  updateDifficulty,
  deleteDifficulty,
} from '../controllers/difficultyController.js';

const router = express.Router();

router.post('/', authenticateAdmin, createDifficulty);
router.get('/', authenticateAdmin, getAllDifficulties);
router.put('/:id', authenticateAdmin, updateDifficulty);
router.delete('/:id', authenticateAdmin, deleteDifficulty);

export default router;