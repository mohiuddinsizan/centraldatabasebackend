import express from 'express';
import { authenticateAdmin } from '../middleware/auth.js';
import {
  createTag,
  getAllTags,
  updateTag,
  deleteTag,
} from '../controllers/tagController.js';

const router = express.Router();

router.post('/', authenticateAdmin, createTag);
router.get('/', authenticateAdmin, getAllTags);
router.put('/:id', authenticateAdmin, updateTag);
router.delete('/:id', authenticateAdmin, deleteTag);

export default router;