import multer from 'multer';
import { Request, Response, NextFunction } from 'express';
import { sendError } from '../utils/response';
import { AVATAR_ALLOWED_MIME, AVATAR_MAX_BYTES } from '../services/avatar-storage.service';

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: AVATAR_MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!AVATAR_ALLOWED_MIME.has(file.mimetype)) {
      cb(new Error('Only JPEG, PNG, and WebP avatars are allowed'));
      return;
    }
    cb(null, true);
  },
});

export const avatarUploadMiddleware = avatarUpload.single('avatar');

export function handleAvatarMulterError(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!err) {
    next();
    return;
  }

  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      sendError(res, 'VALIDATION_ERROR', 'Avatar file exceeds 5MB limit', 400);
      return;
    }
    sendError(res, 'VALIDATION_ERROR', err.message, 400);
    return;
  }

  if (err instanceof Error) {
    sendError(res, 'VALIDATION_ERROR', err.message, 400);
    return;
  }

  next(err);
}
