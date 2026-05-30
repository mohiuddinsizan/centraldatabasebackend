import express from 'express';
import { authenticateAdmin } from '../middleware/auth.js';
import {
  createYear,
  getAllYears,
  updateYear,
  deleteYear,
} from '../controllers/yearController.js';

const router = express.Router();

router.post('/', authenticateAdmin, createYear);
router.get('/', authenticateAdmin, getAllYears);
router.put('/:id', authenticateAdmin, updateYear);
router.delete('/:id', authenticateAdmin, deleteYear);

export default router;