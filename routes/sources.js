import express from 'express';
import { authenticateAdmin } from '../middleware/auth.js';
import {
  createSource,
  getAllSources,
  updateSource,
  deleteSource,
} from '../controllers/sourceController.js';

const router = express.Router();

router.post('/', authenticateAdmin, createSource);
router.get('/', authenticateAdmin, getAllSources);
router.put('/:id', authenticateAdmin, updateSource);
router.delete('/:id', authenticateAdmin, deleteSource);

export default router;