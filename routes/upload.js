import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { authenticateAdmin } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { upload, uploadMultiple, getPresignedUrl } from '../config/s3.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const isS3Configured = process.env.AWS_ACCESS_KEY_ID &&
                       process.env.AWS_SECRET_ACCESS_KEY &&
                       process.env.S3_BUCKET_NAME;

const s3Client = isS3Configured ? new S3Client({
  region: process.env.AWS_REGION || 'ap-south-1',
  endpoint: process.env.S3_ENDPOINT || 'https://ap-south-1.linodeobjects.com', // 👈 Linode endpoint
  forcePathStyle: false,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
}) : null;

const router = express.Router();

// Both admins and uploaders need uploads to build a question.
const canUpload = requireRole('admin', 'uploader');

// ── Upload multiple images ──────────────────────────────────────
router.post('/', authenticateAdmin, canUpload, (req, res) => {
  uploadMultiple(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }
    try {
      const uploadedFiles = await Promise.all(
        req.files.map(async (file) => {
          const key = file.key || `uploads/${file.filename}`;
          const presignedUrl = await getPresignedUrl(key);
          return { key, presignedUrl, originalName: file.originalname, size: file.size, mimetype: file.mimetype };
        })
      );
      res.json({ message: 'Files uploaded successfully', files: uploadedFiles });
    } catch (error) {
      console.error('Upload response error:', error.message);
      res.status(500).json({ error: error.message });
    }
  });
});

// ── Generate presigned URL for a key ───────────────────────────
// GET /api/upload/presign?key=uploads/xxxx.jpg
router.get('/presign', authenticateAdmin, canUpload, async (req, res) => {
  try {
    const { key } = req.query;
    if (!key) return res.status(400).json({ error: 'key is required' });
    const url = await getPresignedUrl(key);
    if (!url) return res.status(404).json({ error: 'Could not generate URL for key' });
    res.json({ url });
  } catch (error) {
    console.error('Presign error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ── Delete image ────────────────────────────────────────────────
// DELETE /api/upload?key=uploads/xxxx.jpg
router.delete('/', authenticateAdmin, canUpload, async (req, res) => {
  try {
    const key = req.query.key;
    if (!key) return res.status(400).json({ error: 'File key is required' });

    if (isS3Configured && s3Client) {
      await s3Client.send(new DeleteObjectCommand({
        Bucket: process.env.S3_BUCKET_NAME,
        Key: key,
      }));
      return res.json({ message: 'File deleted successfully', key });
    }

    const filePath = path.join(__dirname, '..', key);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return res.json({ message: 'File deleted successfully', key });
    }

    return res.status(404).json({ error: 'File not found' });
  } catch (error) {
    console.error('Delete error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

export default router;