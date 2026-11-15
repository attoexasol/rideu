import multer from 'multer';
import { Request, Response, NextFunction } from 'express';
import { sendError } from '../utils/response';
import {
  DRIVER_DOCUMENT_ALLOWED_MIME,
  driverDocumentConfig,
} from '../config/driverDocuments';

const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: driverDocumentConfig.maxBytes, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!(file.mimetype in DRIVER_DOCUMENT_ALLOWED_MIME)) {
      cb(new Error('Only PDF, JPEG, and PNG documents are allowed'));
      return;
    }
    cb(null, true);
  },
});

export const driverDocumentUploadMiddleware = documentUpload.single('file');

export function handleDriverDocumentMulterError(
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
      sendError(
        res,
        'FILE_TOO_LARGE',
        `Document exceeds ${Math.floor(driverDocumentConfig.maxBytes / (1024 * 1024))} MB limit`,
        413
      );
      return;
    }
    sendError(res, 'VALIDATION_ERROR', err.message, 400);
    return;
  }

  if (err instanceof Error) {
    sendError(res, 'INVALID_DOCUMENT_TYPE', err.message, 400);
    return;
  }

  next(err);
}
