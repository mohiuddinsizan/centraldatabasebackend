import express from 'express';
import { authenticateAdmin } from '../middleware/auth.js';
import {
  createQuestion,
  getQuestions,
  getSingleQuestion,
  updateQuestion,
  moveQuestion,
  copyQuestion,
  deleteQuestion,
} from '../controllers/questionController.js';

const router = express.Router();

router.post('/', authenticateAdmin, createQuestion);
router.get('/', authenticateAdmin, getQuestions);
router.get('/:id', authenticateAdmin, getSingleQuestion);
router.put('/:id', authenticateAdmin, updateQuestion);
router.put('/:id/move', authenticateAdmin, moveQuestion);
router.post('/:id/copy', authenticateAdmin, copyQuestion);
router.delete('/:id', authenticateAdmin, deleteQuestion);

export default router;