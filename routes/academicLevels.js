import express from 'express';
import { authenticateAdmin } from '../middleware/auth.js';
import { getAllAcademicLevels } from '../controllers/academicLevelController.js';

const router = express.Router();

router.get('/', authenticateAdmin, getAllAcademicLevels);

export default router;