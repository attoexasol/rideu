import express from 'express';
import { asyncHandler } from '../../../middleware/error-handler';
import { requireAuth, extractUserInfo } from '../../../middleware/auth';
import { requireDriver } from '../../../middleware/rbac';
import { driverGeneralRateLimit } from '../../../middleware/rate-limiters';
import { validate, driverPaymentHistoryQuerySchema, paymentIdParamSchema } from '../../../validators';
import {
  getDriverPaymentDetailHandler,
  getDriverPaymentSummaryHandler,
  listDriverPaymentsHandler,
} from '../../../controllers/driverPayment.controller';

const router = express.Router();
const driverAuth = [requireAuth, extractUserInfo, ...requireDriver];

router.get(
  '/',
  ...driverAuth,
  driverGeneralRateLimit,
  validate(driverPaymentHistoryQuerySchema, 'query'),
  asyncHandler(listDriverPaymentsHandler)
);

router.get(
  '/summary',
  ...driverAuth,
  driverGeneralRateLimit,
  asyncHandler(getDriverPaymentSummaryHandler)
);

router.get(
  '/:paymentId',
  ...driverAuth,
  driverGeneralRateLimit,
  validate(paymentIdParamSchema, 'params'),
  asyncHandler(getDriverPaymentDetailHandler)
);

export default router;
