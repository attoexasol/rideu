import express from 'express';
import { asyncHandler } from '../../../middleware/error-handler';
import { requireAuth, extractUserInfo } from '../../../middleware/auth';
import { requireDriver } from '../../../middleware/rbac';
import {
  validate,
  bookingIdParamSchema,
  driverBookingStatusSchema,
  offerIdParamSchema,
  declineOfferSchema,
  driverCancelBookingSchema,
} from '../../../validators';
import { driverOfferRateLimit, driverRecoveryRateLimit } from '../../../middleware/rate-limiters';
import {
  listOffersHandler,
  listPendingOffersHandler,
  getOfferHandler,
  activeBookingHandler,
  getBookingHandler,
  acceptOfferHandler,
  rejectOfferHandler,
  declineOfferHandler,
  updateStatusHandler,
  cancelBookingHandler,
} from '../../../controllers/driverBooking.controller';
import {
  createVideoSessionHandler,
  getVideoSessionStatusHandler,
} from '../../../controllers/rideVideo.controller';

const router = express.Router();
const driverAuth = [requireAuth, extractUserInfo, ...requireDriver];

router.get('/active', ...driverAuth, driverRecoveryRateLimit, asyncHandler(activeBookingHandler));

router.get(
  '/offers/pending',
  ...driverAuth,
  driverRecoveryRateLimit,
  asyncHandler(listPendingOffersHandler)
);

router.get(
  '/offers/:offerId',
  ...driverAuth,
  validate(offerIdParamSchema, 'params'),
  asyncHandler(getOfferHandler)
);

router.get('/offers', ...driverAuth, asyncHandler(listOffersHandler));

router.get(
  '/:bookingId',
  ...driverAuth,
  validate(bookingIdParamSchema, 'params'),
  asyncHandler(getBookingHandler)
);

router.post(
  '/:bookingId/accept',
  ...driverAuth,
  driverOfferRateLimit,
  validate(bookingIdParamSchema, 'params'),
  asyncHandler(acceptOfferHandler)
);

router.post(
  '/:bookingId/reject',
  ...driverAuth,
  validate(bookingIdParamSchema, 'params'),
  asyncHandler(rejectOfferHandler)
);

router.post(
  '/:bookingId/decline',
  ...driverAuth,
  driverOfferRateLimit,
  validate(bookingIdParamSchema, 'params'),
  validate(declineOfferSchema),
  asyncHandler(declineOfferHandler)
);

router.patch(
  '/:bookingId/status',
  ...driverAuth,
  driverOfferRateLimit,
  validate(bookingIdParamSchema, 'params'),
  validate(driverBookingStatusSchema),
  asyncHandler(updateStatusHandler)
);

router.post(
  '/:bookingId/cancel',
  ...driverAuth,
  validate(bookingIdParamSchema, 'params'),
  validate(driverCancelBookingSchema),
  asyncHandler(cancelBookingHandler)
);

router.post(
  '/:bookingId/video/session',
  ...driverAuth,
  validate(bookingIdParamSchema, 'params'),
  asyncHandler(createVideoSessionHandler)
);

router.get(
  '/:bookingId/video/session',
  ...driverAuth,
  driverRecoveryRateLimit,
  validate(bookingIdParamSchema, 'params'),
  asyncHandler(getVideoSessionStatusHandler)
);

export default router;
