import express from 'express';
import { asyncHandler } from '../../../middleware/error-handler';
import { requireAuth, extractUserInfo } from '../../../middleware/auth';
import { requireDriver } from '../../../middleware/rbac';
import { softMeterRateLimit } from '../../../middleware/rate-limiters';
import { validate } from '../../../validators';
import {
  meterPauseSchema,
  meterPointsSchema,
  meterSessionIdParamSchema,
} from '../../../validators/softMeter';
import {
  activeMeterHandler,
  meterPointsHandler,
  meterStateHandler,
  pauseMeterHandler,
  resumeMeterHandler,
} from '../../../controllers/softMeter.controller';

const router = express.Router();
const driverAuth = [requireAuth, extractUserInfo, ...requireDriver];

router.get('/active', ...driverAuth, softMeterRateLimit, asyncHandler(activeMeterHandler));
router.get(
  '/:sessionId',
  ...driverAuth,
  softMeterRateLimit,
  validate(meterSessionIdParamSchema, 'params'),
  asyncHandler(meterStateHandler)
);
router.post(
  '/:sessionId/pause',
  ...driverAuth,
  softMeterRateLimit,
  validate(meterSessionIdParamSchema, 'params'),
  validate(meterPauseSchema),
  asyncHandler(pauseMeterHandler)
);
router.post(
  '/:sessionId/resume',
  ...driverAuth,
  softMeterRateLimit,
  validate(meterSessionIdParamSchema, 'params'),
  validate(meterPauseSchema),
  asyncHandler(resumeMeterHandler)
);
router.post(
  '/:sessionId/points',
  ...driverAuth,
  softMeterRateLimit,
  validate(meterSessionIdParamSchema, 'params'),
  validate(meterPointsSchema),
  asyncHandler(meterPointsHandler)
);

export default router;
