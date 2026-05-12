import express from 'express';
import { authenticateAdmin } from '../middleware/auth.js';
import {
  createChapter,
  getChaptersByArchive,
  getAllChapters,
  updateChapter,
  deleteChapter,
} from '../controllers/chapterController.js';

const router = express.Router();

router.post('/', authenticateAdmin, createChapter);
router.get('/archive/:archiveId', authenticateAdmin, getChaptersByArchive);
router.get('/', authenticateAdmin, getAllChapters);
router.put('/:id', authenticateAdmin, updateChapter);
router.delete('/:id', authenticateAdmin, deleteChapter);

export default router;