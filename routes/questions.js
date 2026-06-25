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
  listTrash,
  restoreQuestion,
  permanentDeleteQuestion,
} from '../controllers/questionController.js';

const router = express.Router();

// ── Trash (super admin only) ────────────────────────────────────
// Declared BEFORE '/:id' so '/trash' isn't captured as an :id.
router.get('/trash', authenticateAdmin, requireRole('super_admin'), listTrash);

// ── Uploaders + admins ──────────────────────────────────────────
// Create a question, and view questions (the "all questions" page).
router.post('/',    authenticateAdmin, requireRole('admin', 'uploader'), createQuestion);
router.get('/',     authenticateAdmin, requireRole('admin', 'uploader'), getQuestions);
router.get('/:id',  authenticateAdmin, requireRole('admin', 'uploader'), getSingleQuestion);

// ── Admins only ─────────────────────────────────────────────────
// Editing, moving, copying are off-limits to uploaders.
router.put('/:id',       authenticateAdmin, requireRole('admin'), updateQuestion);
router.put('/:id/move',  authenticateAdmin, requireRole('admin'), moveQuestion);
router.post('/:id/copy', authenticateAdmin, requireRole('admin'), copyQuestion);

// Soft delete (admins + super admins) — moves the question to trash.
router.delete('/:id',    authenticateAdmin, requireRole('admin'), deleteQuestion);

// ── Trash actions (super admin only) ────────────────────────────
router.patch('/:id/restore',    authenticateAdmin, requireRole('super_admin'), restoreQuestion);
router.delete('/:id/permanent', authenticateAdmin, requireRole('super_admin'), permanentDeleteQuestion);

export default router;