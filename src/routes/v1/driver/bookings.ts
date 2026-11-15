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
  bookingHistoryQuerySchema,
} from '../../../validators';
import {
  driverOfferRateLimit,
  driverRecoveryRateLimit,
  softMeterRateLimit,
  videoUploadRateLimit,
} from '../../../middleware/rate-limiters';
import {
  listOffersHandler,
  listPendingOffersHandler,
  getOfferHandler,
  activeBookingHandler,
  listBookingsHandler,
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
import {
  bookingMeterPointsHandler,
  finalizeBookingMeterHandler,
  readBookingMeterHandler,
  startBookingMeterHandler,
  stopBookingMeterHandler,
} from '../../../controllers/softMeter.controller';
import { meterIdempotencySchema, meterPointsSchema } from '../../../validators/softMeter';

const router = express.Router();
const driverAuth = [requireAuth, extractUserInfo, ...requireDriver];

router.get('/active', ...driverAuth, driverRecoveryRateLimit, asyncHandler(activeBookingHandler));

router.get(
  '/',
  ...driverAuth,
  validate(bookingHistoryQuerySchema, 'query'),
  asyncHandler(listBookingsHandler)
);

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
  videoUploadRateLimit,
  validate(bookingIdParamSchema, 'params'),
  asyncHandler(createVideoSessionHandler)
);

router.post(
  '/:bookingId/meter/start',
  ...driverAuth,
  softMeterRateLimit,
  validate(bookingIdParamSchema, 'params'),
  validate(meterIdempotencySchema),
  asyncHandler(startBookingMeterHandler)
);

router.get(
  '/:bookingId/meter',
  ...driverAuth,
  softMeterRateLimit,
  validate(bookingIdParamSchema, 'params'),
  asyncHandler(readBookingMeterHandler)
);

router.post(
  '/:bookingId/meter/stop',
  ...driverAuth,
  softMeterRateLimit,
  validate(bookingIdParamSchema, 'params'),
  validate(meterIdempotencySchema),
  asyncHandler(stopBookingMeterHandler)
);

router.post(
  '/:bookingId/meter/finalize',
  ...driverAuth,
  softMeterRateLimit,
  validate(bookingIdParamSchema, 'params'),
  asyncHandler(finalizeBookingMeterHandler)
);

router.post(
  '/:bookingId/meter/points',
  ...driverAuth,
  softMeterRateLimit,
  validate(bookingIdParamSchema, 'params'),
  validate(meterPointsSchema),
  asyncHandler(bookingMeterPointsHandler)
);

router.get(
  '/:bookingId/video/session',
  ...driverAuth,
  driverRecoveryRateLimit,
  validate(bookingIdParamSchema, 'params'),
  asyncHandler(getVideoSessionStatusHandler)
);

export default router;
