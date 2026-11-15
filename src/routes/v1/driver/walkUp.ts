import express from 'express';
import { asyncHandler } from '../../../middleware/error-handler';
import { requireAuth, extractUserInfo } from '../../../middleware/auth';
import { requireDriver } from '../../../middleware/rbac';
import {
  driverCheckoutRateLimit,
  softMeterRateLimit,
} from '../../../middleware/rate-limiters';
import { validate } from '../../../validators';
import {
  createWalkUpSchema,
  meterIdempotencySchema,
  meterPointsSchema,
  walkUpIdParamSchema,
  walkUpPaymentLinkSchema,
} from '../../../validators/softMeter';
import {
  cancelWalkUpHandler,
  createWalkUpHandler,
  endWalkUpHandler,
  getWalkUpHandler,
  listWalkUpHandler,
  startWalkUpHandler,
  walkUpPaymentHandler,
  walkUpPaymentLinkHandler,
  walkUpPointsHandler,
  walkUpReceiptHandler,
} from '../../../controllers/softMeter.controller';

const router = express.Router();
const driverAuth = [requireAuth, extractUserInfo, ...requireDriver];

router.post(
  '/',
  ...driverAuth,
  softMeterRateLimit,
  validate(createWalkUpSchema),
  asyncHandler(createWalkUpHandler)
);
router.get('/', ...driverAuth, softMeterRateLimit, asyncHandler(listWalkUpHandler));
router.get(
  '/:tripId',
  ...driverAuth,
  softMeterRateLimit,
  validate(walkUpIdParamSchema, 'params'),
  asyncHandler(getWalkUpHandler)
);
router.post(
  '/:tripId/meter/start',
  ...driverAuth,
  softMeterRateLimit,
  validate(walkUpIdParamSchema, 'params'),
  validate(meterIdempotencySchema),
  asyncHandler(startWalkUpHandler)
);
router.post(
  '/:tripId/meter/points',
  ...driverAuth,
  softMeterRateLimit,
  validate(walkUpIdParamSchema, 'params'),
  validate(meterPointsSchema),
  asyncHandler(walkUpPointsHandler)
);
router.post(
  '/:tripId/end',
  ...driverAuth,
  softMeterRateLimit,
  validate(walkUpIdParamSchema, 'params'),
  asyncHandler(endWalkUpHandler)
);
router.post(
  '/:tripId/cancel',
  ...driverAuth,
  softMeterRateLimit,
  validate(walkUpIdParamSchema, 'params'),
  asyncHandler(cancelWalkUpHandler)
);
router.post(
  '/:tripId/payment-link',
  ...driverAuth,
  driverCheckoutRateLimit,
  validate(walkUpIdParamSchema, 'params'),
  validate(walkUpPaymentLinkSchema),
  asyncHandler(walkUpPaymentLinkHandler)
);
router.get(
  '/:tripId/payment',
  ...driverAuth,
  softMeterRateLimit,
  validate(walkUpIdParamSchema, 'params'),
  asyncHandler(walkUpPaymentHandler)
);
router.get(
  '/:tripId/receipt',
  ...driverAuth,
  softMeterRateLimit,
  validate(walkUpIdParamSchema, 'params'),
  asyncHandler(walkUpReceiptHandler)
);

export default router;
