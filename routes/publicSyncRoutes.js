import express from 'express';
import {
  getArchives,
  getChapters,
  getTopics,
  getClasses,
  getQuestions,
  getSyncStatus,
  getQuestionsManifest,
} from '../controllers/publicController.js';

const router = express.Router();

/**
 * Optional but recommended:
 * Protect external sync API with x-api-key.
 */
const requireSyncApiKey = (req, res, next) => {
  const apiKey = req.header('x-api-key');

  if (!process.env.PUBLIC_SYNC_API_KEY) {
    console.error('PUBLIC_SYNC_API_KEY is missing in environment variables');
    return res.status(500).json({ error: 'Sync API is not configured' });
  }

  if (!apiKey || apiKey !== process.env.PUBLIC_SYNC_API_KEY) {
    return res.status(401).json({ error: 'Invalid or missing API key' });
  }

  next();
};

// Apply API key protection to all routes in this file
router.use(requireSyncApiKey);

// Basic lists
router.get('/archives', getArchives);
router.get('/chapters', getChapters);
router.get('/topics', getTopics);
router.get('/classes', getClasses);

// Sync endpoints
router.get('/questions', getQuestions);
router.get('/questions/manifest', getQuestionsManifest);
router.get('/sync/status', getSyncStatus);

export default router;