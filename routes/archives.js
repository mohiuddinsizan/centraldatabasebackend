import express from 'express';
import { authenticateAdmin } from '../middleware/auth.js';
import { upload } from '../config/s3.js';
import {
  createArchive,
  getArchives,
  updateArchive,
} from '../controllers/archiveController.js';

const router = express.Router();

router.post('/', authenticateAdmin, upload.single('thumbnail'), createArchive);
router.get('/', authenticateAdmin, getArchives);
router.put('/:id', authenticateAdmin, upload.single('thumbnail'), updateArchive);
// router.delete('/:id', authenticateAdmin, deleteArchive);

export default router;