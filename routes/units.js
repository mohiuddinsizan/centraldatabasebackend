import express from 'express';
import { authenticateAdmin } from '../middleware/auth.js';
import {
  createUnit,
  getAllUnits,
  updateUnit,
  deleteUnit,
} from '../controllers/unitController.js';

const router = express.Router();

router.post('/', authenticateAdmin, createUnit);
router.get('/', authenticateAdmin, getAllUnits);
router.put('/:id', authenticateAdmin, updateUnit);
router.delete('/:id', authenticateAdmin, deleteUnit);

export default router;