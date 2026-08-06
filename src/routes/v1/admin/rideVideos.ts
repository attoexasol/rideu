import express from 'express';
import { asyncHandler } from '../../../middleware/error-handler';
import { requireAuth, extractUserInfo, requireAdmin } from '../../../middleware/auth';
import { requireRideVideoPermission } from '../../../middleware/rideVideoPermissions';
import { RideVideoPermissions } from '../../../constants/rideVideoPermissions';
import { validate } from '../../../validators';
import {
  bookingIdParamSchema,
  videoSessionParamSchema,
  videoSegmentParamSchema,
  adminRideVideoListQuerySchema,
  adminRideVideoSummaryQuerySchema,
  adminRideVideoSegmentsQuerySchema,
  adminRideVideoAuditQuerySchema,
  adminRideVideoPlaybackManifestSchema,
} from '../../../validators';
import {
  listRideVideosHandler,
  rideVideoSummaryHandler,
  getRideVideoSessionHandler,
  getBookingRideVideoHandler,
  listRideVideoSegmentsHandler,
  rideVideoHealthHandler,
  rideVideoTimelineHandler,
  rideVideoPlaybackManifestHandler,
  rideVideoSegmentPlaybackUrlHandler,
  rideVideoAuditHandler,
  rideVideoDownloadHandler,
} from '../../../controllers/adminRideVideo.controller';
import {
  adminRideVideoListRateLimit,
  adminRideVideoPlaybackRateLimit,
  adminRideVideoDownloadRateLimit,
} from '../../../middleware/rate-limiters';

const router = express.Router();

const adminAuth = [requireAuth, extractUserInfo, requireAdmin] as const;

router.get(
  '/ride-videos',
  ...adminAuth,
  adminRideVideoListRateLimit,
  requireRideVideoPermission(RideVideoPermissions.VIEW),
  validate(adminRideVideoListQuerySchema, 'query'),
  asyncHandler(listRideVideosHandler)
);

router.get(
  '/ride-videos/summary',
  ...adminAuth,
  adminRideVideoListRateLimit,
  requireRideVideoPermission(RideVideoPermissions.VIEW),
  validate(adminRideVideoSummaryQuerySchema, 'query'),
  asyncHandler(rideVideoSummaryHandler)
);

router.get(
  '/ride-videos/:sessionId',
  ...adminAuth,
  adminRideVideoListRateLimit,
  requireRideVideoPermission(RideVideoPermissions.VIEW),
  validate(videoSessionParamSchema, 'params'),
  asyncHandler(getRideVideoSessionHandler)
);

router.get(
  '/bookings/:bookingId/ride-video',
  ...adminAuth,
  adminRideVideoListRateLimit,
  requireRideVideoPermission(RideVideoPermissions.VIEW),
  validate(bookingIdParamSchema, 'params'),
  asyncHandler(getBookingRideVideoHandler)
);

router.get(
  '/ride-videos/:sessionId/segments',
  ...adminAuth,
  adminRideVideoListRateLimit,
  requireRideVideoPermission(RideVideoPermissions.VIEW),
  validate(videoSessionParamSchema, 'params'),
  validate(adminRideVideoSegmentsQuerySchema, 'query'),
  asyncHandler(listRideVideoSegmentsHandler)
);

router.get(
  '/ride-videos/:sessionId/health',
  ...adminAuth,
  adminRideVideoListRateLimit,
  requireRideVideoPermission(RideVideoPermissions.VIEW),
  validate(videoSessionParamSchema, 'params'),
  asyncHandler(rideVideoHealthHandler)
);

router.get(
  '/ride-videos/:sessionId/timeline',
  ...adminAuth,
  adminRideVideoListRateLimit,
  requireRideVideoPermission(RideVideoPermissions.VIEW),
  validate(videoSessionParamSchema, 'params'),
  asyncHandler(rideVideoTimelineHandler)
);

router.post(
  '/ride-videos/:sessionId/playback-manifest',
  ...adminAuth,
  adminRideVideoPlaybackRateLimit,
  requireRideVideoPermission(RideVideoPermissions.PLAY),
  validate(videoSessionParamSchema, 'params'),
  validate(adminRideVideoPlaybackManifestSchema),
  asyncHandler(rideVideoPlaybackManifestHandler)
);

router.post(
  '/ride-videos/:sessionId/segments/:segmentId/playback-url',
  ...adminAuth,
  adminRideVideoPlaybackRateLimit,
  requireRideVideoPermission(RideVideoPermissions.PLAY),
  validate(videoSegmentParamSchema, 'params'),
  asyncHandler(rideVideoSegmentPlaybackUrlHandler)
);

router.get(
  '/ride-videos/:sessionId/audit',
  ...adminAuth,
  adminRideVideoListRateLimit,
  requireRideVideoPermission(RideVideoPermissions.AUDIT),
  validate(videoSessionParamSchema, 'params'),
  validate(adminRideVideoAuditQuerySchema, 'query'),
  asyncHandler(rideVideoAuditHandler)
);

router.post(
  '/ride-videos/:sessionId/download',
  ...adminAuth,
  adminRideVideoDownloadRateLimit,
  requireRideVideoPermission(RideVideoPermissions.DOWNLOAD),
  validate(videoSessionParamSchema, 'params'),
  asyncHandler(rideVideoDownloadHandler)
);

export default router;
