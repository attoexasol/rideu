import express from 'express';
import { asyncHandler } from '../../../middleware/error-handler';
import { requireAuth, extractUserInfo, requireAdmin } from '../../../middleware/auth';
import {
  validate,
  assignDriverCategorySchema,
  bookingIdParamSchema,
  videoSegmentIdParamSchema,
} from '../../../validators';
import {
  listCategoriesHandler,
  listDriverCategoriesHandler,
  assignCategoryHandler,
  removeCategoryHandler,
} from '../../../controllers/adminBooking.controller';
import {
  adminBookingVideoHandler,
  adminVideoContentHandler,
  adminVideoReadUrlHandler,
} from '../../../controllers/rideVideo.controller';

const router = express.Router();

router.get(
  '/bookings/:bookingId/video',
  requireAuth,
  extractUserInfo,
  requireAdmin,
  validate(bookingIdParamSchema, 'params'),
  asyncHandler(adminBookingVideoHandler)
);

router.post(
  '/video/segments/:segmentId/read-url',
  requireAuth,
  extractUserInfo,
  requireAdmin,
  validate(videoSegmentIdParamSchema, 'params'),
  asyncHandler(adminVideoReadUrlHandler)
);

// The short-lived signed token is the authorization for media bytes.
router.get(
  '/video/segments/:segmentId/content',
  validate(videoSegmentIdParamSchema, 'params'),
  asyncHandler(adminVideoContentHandler)
);

router.get(
  '/service-categories',
  requireAuth,
  extractUserInfo,
  requireAdmin,
  asyncHandler(listCategoriesHandler)
);

router.get(
  '/drivers/:driverId/service-categories',
  requireAuth,
  extractUserInfo,
  requireAdmin,
  asyncHandler(listDriverCategoriesHandler)
);

router.post(
  '/driver-service-categories',
  requireAuth,
  extractUserInfo,
  requireAdmin,
  validate(assignDriverCategorySchema),
  asyncHandler(assignCategoryHandler)
);

router.delete(
  '/drivers/:driverId/service-categories/:categoryId',
  requireAuth,
  extractUserInfo,
  requireAdmin,
  asyncHandler(removeCategoryHandler)
);

export default router;
