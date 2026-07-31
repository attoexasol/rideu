import multer from 'multer';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { randomUUID } from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { sendError } from '../utils/response';

const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB

const ALLOWED_MIME_TYPES = new Set(['video/mp4', 'video/quicktime']);

const BLOCKED_EXTENSIONS = new Set([
  '.exe',
  '.zip',
  '.rar',
  '.7z',
  '.bat',
  '.cmd',
  '.sh',
  '.js',
  '.html',
]);

function hasValidVideoMagicBuffer(buffer: Buffer): boolean {
  if (buffer.length < 12) return false;
  return buffer.toString('ascii', 4, 8) === 'ftyp';
}

const diskStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, os.tmpdir());
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.mp4';
    cb(null, `trip-video-${randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage: diskStorage,
  limits: { fileSize: MAX_FILE_SIZE, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (BLOCKED_EXTENSIONS.has(ext)) {
      cb(new Error('File type not allowed'));
      return;
    }
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(new Error('Only video/mp4 and video/quicktime uploads are allowed'));
      return;
    }
    cb(null, true);
  },
});

export const videoUploadMiddleware = upload.single('video_file');

const liveChunkUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(new Error('Only video/mp4 and video/quicktime uploads are allowed'));
      return;
    }
    cb(null, true);
  },
});

export const liveVideoChunkMiddleware = liveChunkUpload.single('video_file');

export async function validateUploadedVideo(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  console.log('[UploadMiddleware] validateUploadedVideo:start', {
    hasFile: Boolean(req.file),
    body: req.body,
  });

  if (!req.file) {
    sendError(res, 'VALIDATION_ERROR', 'video_file is required', 400);
    return;
  }

  const ext = path.extname(req.file.originalname).toLowerCase();
  if (BLOCKED_EXTENSIONS.has(ext)) {
    await fs.unlink(req.file.path).catch(() => undefined);
    sendError(res, 'VALIDATION_ERROR', 'File type not allowed', 400);
    return;
  }

  if (!ALLOWED_MIME_TYPES.has(req.file.mimetype)) {
    await fs.unlink(req.file.path).catch(() => undefined);
    sendError(res, 'VALIDATION_ERROR', 'Invalid MIME type', 400);
    return;
  }

  try {
    const handle = await fs.open(req.file.path, 'r');
    const buffer = Buffer.alloc(12);
    await handle.read(buffer, 0, 12, 0);
    await handle.close();

    if (!hasValidVideoMagicBuffer(buffer)) {
      await fs.unlink(req.file.path).catch(() => undefined);
      sendError(res, 'VALIDATION_ERROR', 'File is not a valid MP4/MOV video', 400);
      return;
    }
  } catch {
    await fs.unlink(req.file.path).catch(() => undefined);
    sendError(res, 'VALIDATION_ERROR', 'Unable to validate uploaded video', 400);
    return;
  }

  console.log('[UploadMiddleware] validateUploadedVideo:done', {
    path: req.file.path,
    size: req.file.size,
    mimetype: req.file.mimetype,
  });

  next();
}

export function handleMulterError(
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
      sendError(res, 'VALIDATION_ERROR', 'Video file exceeds 500MB limit', 400);
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
