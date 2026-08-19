import express from 'express';
import { asyncHandler } from '../../../middleware/error-handler';
import { requireAuth, extractUserInfo } from '../../../middleware/auth';
import { requireCustomer } from '../../../middleware/rbac';
import { passengerMapsRateLimit } from '../../../middleware/passenger-maps-rate-limit';
import { passengerBookingCancelRateLimit } from '../../../middleware/passenger-booking-cancel-rate-limit';
import {
  passengerBookingRateLimit,
  passengerRecoveryRateLimit,
} from '../../../middleware/rate-limiters';
import {
  validate,
  bookingQuoteSchema,
  createBookingSchema,
  bookingIdParamSchema,
  cancelBookingSchema,
  placesAutocompleteQuerySchema,
  placeDetailsQuerySchema,
  reverseGeocodeQuerySchema,
  pickupSpotsQuerySchema,
  routePreviewSchema,
  savePlaceSchema,
  updatePlaceSchema,
  placeIdParamSchema,
  nearbyDriversQuerySchema,
  placeSuggestionsQuerySchema,
  recordingConsentSchema,
  bookingHistoryQuerySchema,
} from '../../../validators';
import {
  autocompleteHandler,
  placeDetailsHandler,
  reverseGeocodeHandler,
  suggestionsHandler,
  pickupSpotsHandler,
  savePlaceHandler,
  updatePlaceHandler,
  deletePlaceHandler,
  routePreviewHandler,
  servicesHandler,
  paymentMethodsHandler,
  quoteHandler,
  createBookingHandler,
  listBookingsHandler,
  activeBookingHandler,
  getBookingHandler,
  cancelBookingHandler,
  consentRecordingHandler,
  shareBookingHandler,
  liveVideoHandler,
  nearbyDriversHandler,
} from '../../../controllers/passengerBooking.controller';

const router = express.Router();
const mapsGuard = [requireAuth, extractUserInfo, requireCustomer, passengerMapsRateLimit];

router.get(
  '/places/autocomplete',
  ...mapsGuard,
  validate(placesAutocompleteQuerySchema, 'query'),
  asyncHandler(autocompleteHandler)
);
router.get(
  '/places/details',
  ...mapsGuard,
  validate(placeDetailsQuerySchema, 'query'),
  asyncHandler(placeDetailsHandler)
);
router.get(
  '/places/reverse-geocode',
  ...mapsGuard,
  validate(reverseGeocodeQuerySchema, 'query'),
  asyncHandler(reverseGeocodeHandler)
);
router.get(
  '/places/suggestions',
  requireAuth,
  extractUserInfo,
  requireCustomer,
  validate(placeSuggestionsQuerySchema, 'query'),
  asyncHandler(suggestionsHandler)
);
router.get(
  '/pickup-spots',
  ...mapsGuard,
  validate(pickupSpotsQuerySchema, 'query'),
  asyncHandler(pickupSpotsHandler)
);
router.post(
  '/places',
  requireAuth,
  extractUserInfo,
  requireCustomer,
  validate(savePlaceSchema),
  asyncHandler(savePlaceHandler)
);
router.patch(
  '/places/:placeId',
  requireAuth,
  extractUserInfo,
  requireCustomer,
  validate(placeIdParamSchema, 'params'),
  validate(updatePlaceSchema),
  asyncHandler(updatePlaceHandler)
);
router.delete(
  '/places/:placeId',
  requireAuth,
  extractUserInfo,
  requireCustomer,
  validate(placeIdParamSchema, 'params'),
  asyncHandler(deletePlaceHandler)
);

router.post(
  '/routes/preview',
  ...mapsGuard,
  validate(routePreviewSchema),
  asyncHandler(routePreviewHandler)
);

router.get(
  '/services',
  requireAuth,
  extractUserInfo,
  requireCustomer,
  asyncHandler(servicesHandler)
);
router.get(
  '/payment-methods',
  requireAuth,
  extractUserInfo,
  requireCustomer,
  asyncHandler(paymentMethodsHandler)
);
router.get(
  '/drivers/nearby',
  requireAuth,
  extractUserInfo,
  requireCustomer,
  validate(nearbyDriversQuerySchema, 'query'),
  asyncHandler(nearbyDriversHandler)
);

router.post(
  '/bookings/quote',
  ...mapsGuard,
  validate(bookingQuoteSchema),
  asyncHandler(quoteHandler)
);
router.post(
  '/bookings',
  requireAuth,
  extractUserInfo,
  requireCustomer,
  passengerBookingRateLimit,
  validate(createBookingSchema),
  asyncHandler(createBookingHandler)
);
router.get(
  '/bookings',
  requireAuth,
  extractUserInfo,
  requireCustomer,
  validate(bookingHistoryQuerySchema, 'query'),
  asyncHandler(listBookingsHandler)
);
router.get(
  '/bookings/active',
  requireAuth,
  extractUserInfo,
  requireCustomer,
  passengerRecoveryRateLimit,
  asyncHandler(activeBookingHandler)
);
router.get(
  '/bookings/:bookingId',
  requireAuth,
  extractUserInfo,
  requireCustomer,
  validate(bookingIdParamSchema, 'params'),
  asyncHandler(getBookingHandler)
);
router.post(
  '/bookings/:bookingId/cancel',
  requireAuth,
  extractUserInfo,
  requireCustomer,
  passengerBookingCancelRateLimit,
  validate(bookingIdParamSchema, 'params'),
  validate(cancelBookingSchema),
  asyncHandler(cancelBookingHandler)
);
router.post(
  '/bookings/:bookingId/recording-consent',
  requireAuth,
  extractUserInfo,
  requireCustomer,
  validate(bookingIdParamSchema, 'params'),
  validate(recordingConsentSchema),
  asyncHandler(consentRecordingHandler)
);
router.get(
  '/bookings/:bookingId/share',
  requireAuth,
  extractUserInfo,
  requireCustomer,
  validate(bookingIdParamSchema, 'params'),
  asyncHandler(shareBookingHandler)
);
router.get(
  '/bookings/:bookingId/live-video',
  requireAuth,
  extractUserInfo,
  requireCustomer,
  validate(bookingIdParamSchema, 'params'),
  asyncHandler(liveVideoHandler)
);

export default router;
