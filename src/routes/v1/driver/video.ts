import express from 'express';
import { videoConfig } from '../../../config/video';
import {
  completeVideoSegmentHandler,
  failVideoSegmentHandler,
  finalizeVideoSessionHandler,
  listVideoSegmentsHandler,
  pauseVideoSessionHandler,
  registerVideoSegmentHandler,
  resumeVideoSessionHandler,
  uploadRegisteredVideoSegmentHandler,
} from '../../../controllers/rideVideo.controller';
import { requireAuth, extractUserInfo } from '../../../middleware/auth';
import { asyncHandler } from '../../../middleware/error-handler';
import { videoUploadRateLimit } from '../../../middleware/rate-limiters';
import { requireDriver } from '../../../middleware/rbac';
import {
  completeVideoSegmentSchema,
  failVideoSegmentSchema,
  registerVideoSegmentSchema,
  validate,
  videoSegmentIdParamSchema,
  videoSegmentListQuerySchema,
  videoSegmentParamSchema,
  videoSessionParamSchema,
} from '../../../validators';

const router = express.Router();
const driverAuth = [requireAuth, extractUserInfo, ...requireDriver];

router.post(
  '/sessions/:sessionId/segments',
  ...driverAuth,
  videoUploadRateLimit,
  validate(videoSessionParamSchema, 'params'),
  validate(registerVideoSegmentSchema),
  asyncHandler(registerVideoSegmentHandler)
);

router.put(
  '/segments/:segmentId/upload',
  ...driverAuth,
  videoUploadRateLimit,
  validate(videoSegmentIdParamSchema, 'params'),
  express.raw({
    type: ['video/mp4', 'video/quicktime'],
    limit: videoConfig.maxSegmentSizeBytes,
  }),
  asyncHandler(uploadRegisteredVideoSegmentHandler)
);

router.post(
  '/sessions/:sessionId/segments/:segmentId/complete',
  ...driverAuth,
  validate(videoSegmentParamSchema, 'params'),
  validate(completeVideoSegmentSchema),
  asyncHandler(completeVideoSegmentHandler)
);

router.post(
  '/sessions/:sessionId/segments/:segmentId/failed',
  ...driverAuth,
  validate(videoSegmentParamSchema, 'params'),
  validate(failVideoSegmentSchema),
  asyncHandler(failVideoSegmentHandler)
);

router.get(
  '/sessions/:sessionId/segments',
  ...driverAuth,
  validate(videoSessionParamSchema, 'params'),
  validate(videoSegmentListQuerySchema, 'query'),
  asyncHandler(listVideoSegmentsHandler)
);

router.post(
  '/sessions/:sessionId/pause',
  ...driverAuth,
  validate(videoSessionParamSchema, 'params'),
  asyncHandler(pauseVideoSessionHandler)
);

router.post(
  '/sessions/:sessionId/resume',
  ...driverAuth,
  validate(videoSessionParamSchema, 'params'),
  asyncHandler(resumeVideoSessionHandler)
);

router.post(
  '/sessions/:sessionId/finalize',
  ...driverAuth,
  validate(videoSessionParamSchema, 'params'),
  asyncHandler(finalizeVideoSessionHandler)
);

export default router;
