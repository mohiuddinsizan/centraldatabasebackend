import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import multer from 'multer';
import multerS3 from 'multer-s3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const isS3Configured = process.env.AWS_ACCESS_KEY_ID &&
                       process.env.AWS_SECRET_ACCESS_KEY &&
                       process.env.S3_BUCKET_NAME;

// Shared S3 client — used by both multer and presigner
let s3Client = null;

let upload;

if (isS3Configured) {
  s3Client = new S3Client({
    region: process.env.AWS_REGION || 'ap-south-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });

  upload = multer({
    storage: multerS3({
      s3: s3Client,
      bucket: process.env.S3_BUCKET_NAME,
      // No ACL — bucket stays private
      metadata: (req, file, cb) => {
        cb(null, { fieldName: file.fieldname });
      },
      key: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
        // Stored in S3 under uploads/ prefix
        // req.file.key will be exactly this string: "uploads/xxxx.jpg"
        cb(null, `uploads/${uniqueName}`);
      },
    }),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      const allowedTypes = /jpeg|jpg|png|gif|svg|webp/;
      const ext = allowedTypes.test(path.extname(file.originalname).toLowerCase());
      const mime = allowedTypes.test(file.mimetype);
      if (ext && mime) return cb(null, true);
      cb(new Error('Only image files are allowed'));
    },
  });

  console.log('✅ AWS S3 storage configured');
} else {
  // Local storage fallback
  const uploadDir = path.join(__dirname, '../uploads');
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

  upload = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => cb(null, uploadDir),
      filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
        // req.file.filename will be "xxxx.jpg"
        // We manually prefix with "uploads/" when saving to DB
        cb(null, uniqueName);
      },
    }),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      const allowedTypes = /jpeg|jpg|png|gif|svg|webp/;
      const ext = allowedTypes.test(path.extname(file.originalname).toLowerCase());
      const mime = allowedTypes.test(file.mimetype);
      if (ext && mime) return cb(null, true);
      cb(new Error('Only image files are allowed'));
    },
  });

  console.log('⚠️  Using local storage (AWS S3 not configured)');
}

/**
 * Generate a 1-hour presigned GET URL for an S3 key.
 * key format stored in DB: "uploads/xxxx.jpg"
 *
 * Returns:
 *   - S3: presigned https URL valid for 1 hour
 *   - Local: full localhost URL  e.g. http://localhost:5000/uploads/xxxx.jpg
 *   - null: if no key provided
 */
const getPresignedUrl = async (key) => {
  if (!key) return null;
  // Remove the 'if startsWith http' guard — keys should never be full URLs now

  if (isS3Configured && s3Client) {
    try {
      const command = new GetObjectCommand({
        Bucket: process.env.S3_BUCKET_NAME,
        Key: key,
      });
      return await getSignedUrl(s3Client, command, { expiresIn: 3600 });
    } catch (err) {
      console.error('Presign error for key:', key, err.message);
      return null;
    }
  }

  const PORT = process.env.PORT || 5000;
  return `http://localhost:${PORT}/${key}`;
};

const uploadMultiple = upload.array('images', 20);

export { upload, uploadMultiple, getPresignedUrl };