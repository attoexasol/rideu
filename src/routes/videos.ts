/**
 * Video Routes
 *
 * POST   /api/videos/upload       - Upload trip video (driver)
 * POST   /api/videos/live-chunk   - Live safety video segment (driver)
 * GET    /api/videos/:videoId     - Video metadata
 * DELETE /api/videos/:videoId     - Delete video (admin)
 */

import express from 'express';
import { requireAuth, extractUserInfo } from '../middleware/auth';
import { requireAdmin, requireDriver } from '../middleware/rbac';
import {
  uploadVideoHandler,
  getVideoHandler,
  deleteVideoHandler,
  multerErrorWrapper,
} from '../controllers/video.controller';
import { uploadLiveChunkHandler } from '../controllers/liveVideo.controller';
import {
  videoUploadMiddleware,
  validateUploadedVideo,
  liveVideoChunkMiddleware,
} from '../middleware/upload';
import { validate, videoIdParamSchema, liveVideoChunkSchema } from '../validators';
import { asyncHandler } from '../middleware/error-handler';

const router = express.Router();

const logVideoUploadAuth = (
  req: express.Request,
  _res: express.Response,
  next: express.NextFunction
): void => {
  const user = (req as any).user;
  const authPayload = (req as any).auth?.payload || (req as any).auth;
  console.log('user:', user);
  console.log(
    'session:',
    authPayload ? { sessionId: authPayload.sessionId, iat: authPayload.iat } : null
  );
  console.log('deviceId header:', req.headers['x-device-id']);
  next();
};

router.post(
  '/live-chunk',
  requireAuth,
  extractUserInfo,
  ...requireDriver,
  (req, res, next) => {
    liveVideoChunkMiddleware(req, res, (err) => {
      if (err) return multerErrorWrapper(err, req, res, next);
      next();
    });
  },
  validate(liveVideoChunkSchema),
  asyncHandler(uploadLiveChunkHandler)
);

router.post(
  '/upload',
  requireAuth,
  extractUserInfo,
  logVideoUploadAuth,
  ...requireDriver,
  (req, res, next) => {
    videoUploadMiddleware(req, res, (err) => {
      if (err) return multerErrorWrapper(err, req, res, next);
      next();
    });
  },
  validateUploadedVideo,
  asyncHandler(uploadVideoHandler)
);

router.get(
  '/:videoId',
  requireAuth,
  extractUserInfo,
  validate(videoIdParamSchema, 'params'),
  asyncHandler(getVideoHandler)
);

router.delete(
  '/:videoId',
  requireAuth,
  extractUserInfo,
  requireAdmin,
  validate(videoIdParamSchema, 'params'),
  asyncHandler(deleteVideoHandler)
);

export default router;
