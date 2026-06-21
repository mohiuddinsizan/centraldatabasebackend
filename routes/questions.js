import express from 'express';
import { authenticateAdmin } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
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

// ── Uploaders + admins ──────────────────────────────────────────
// Create a question, and view questions (the "all questions" page).
router.post('/',    authenticateAdmin, requireRole('admin', 'uploader'), createQuestion);
router.get('/',     authenticateAdmin, requireRole('admin', 'uploader'), getQuestions);
router.get('/:id',  authenticateAdmin, requireRole('admin', 'uploader'), getSingleQuestion);

// ── Admins only ─────────────────────────────────────────────────
// Editing, moving, copying, deleting are off-limits to uploaders.
router.put('/:id',       authenticateAdmin, requireRole('admin'), updateQuestion);
router.put('/:id/move',  authenticateAdmin, requireRole('admin'), moveQuestion);
router.post('/:id/copy', authenticateAdmin, requireRole('admin'), copyQuestion);
router.delete('/:id',    authenticateAdmin, requireRole('admin'), deleteQuestion);

export default router;