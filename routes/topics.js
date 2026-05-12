import express from 'express';
import { authenticateAdmin } from '../middleware/auth.js';
import {
  createTopic,
  getTopicsByChapter,
  getAllTopics,
  updateTopic,
  deleteTopic,
} from '../controllers/topicController.js';

const router = express.Router();

router.post('/', authenticateAdmin, createTopic);
router.get('/chapter/:chapterId', authenticateAdmin, getTopicsByChapter);
router.get('/', authenticateAdmin, getAllTopics);
router.put('/:id', authenticateAdmin, updateTopic);
router.delete('/:id', authenticateAdmin, deleteTopic);

export default router;