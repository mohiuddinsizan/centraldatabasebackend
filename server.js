import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import dotenv from 'dotenv';

dotenv.config();

import errorHandler from './middleware/errorHandler.js';
import adminRoutes from './routes/admin.js';
import archiveRoutes from './routes/archives.js';
import chapterRoutes from './routes/chapters.js';
import topicRoutes from './routes/topics.js';
import questionRoutes from './routes/questions.js';
import tagRoutes from './routes/tags.js';
import sourceRoutes from './routes/sources.js';
import difficultyRoutes from './routes/difficulties.js';
import academicLevelRoutes from './routes/academicLevels.js';
import uploadRoutes from './routes/upload.js';
import analyticsRouter from './routes/analyticsRouter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();

const allowedOrigins = [
  'https://centraldatabasefrontend.vercel.app',
  'http://localhost:3000',
];

app.use((req, res, next) => {
  console.log('Method:', req.method, 'Path:', req.path, 'Origin:', req.headers.origin);
  next();
});

app.use(helmet());

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 204,
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use('/api/admin', adminRoutes);
app.use('/api/archives', archiveRoutes);
app.use('/api/chapters', chapterRoutes);
app.use('/api/topics', topicRoutes);
app.use('/api/questions', questionRoutes);
app.use('/api/tags', tagRoutes);
app.use('/api/sources', sourceRoutes);
app.use('/api/difficulties', difficultyRoutes);
app.use('/api/academic-levels', academicLevelRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/analytics', analyticsRouter);

app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date(),
    environment: process.env.NODE_ENV,
  });
});

app.get('/api', (req, res) => {
  res.json({
    message: 'Question Bank API',
    version: '2.0.0',
    endpoints: {
      admin: '/api/admin',
      archives: '/api/archives',
      chapters: '/api/chapters',
      topics: '/api/topics',
      questions: '/api/questions',
      tags: '/api/tags',
      sources: '/api/sources',
      difficulties: '/api/difficulties',
      academicLevels: '/api/academic-levels',
      upload: '/api/upload',
      analytics: '/api/analytics',
    },
  });
});

app.use(errorHandler);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log('✅ Allowed origins:', allowedOrigins);
});