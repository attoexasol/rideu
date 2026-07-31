import express from 'express';
import { asyncHandler } from '../../../middleware/error-handler';
import { requireAuth, extractUserInfo } from '../../../middleware/auth';
import { requireDriver } from '../../../middleware/rbac';
import {
  validate,
  initiateExchangeSchema,
  confirmExchangeSchema,
  cancelExchangeSchema,
  exchangeIdParamSchema,
} from '../../../validators';
import {
  initiateExchangeHandler,
  confirmExchangeHandler,
  cancelExchangeHandler,
  currentExchangeHandler,
} from '../../../controllers/vehicleExchange.controller';

const router = express.Router();
const driverAuth = [requireAuth, extractUserInfo, ...requireDriver];

router.post(
  '/',
  ...driverAuth,
  validate(initiateExchangeSchema),
  asyncHandler(initiateExchangeHandler)
);

router.post(
  '/:exchangeId/confirm',
  ...driverAuth,
  validate(exchangeIdParamSchema, 'params'),
  validate(confirmExchangeSchema),
  asyncHandler(confirmExchangeHandler)
);

router.post(
  '/:exchangeId/cancel',
  ...driverAuth,
  validate(exchangeIdParamSchema, 'params'),
  validate(cancelExchangeSchema),
  asyncHandler(cancelExchangeHandler)
);

router.get('/current', ...driverAuth, asyncHandler(currentExchangeHandler));

export default router;
