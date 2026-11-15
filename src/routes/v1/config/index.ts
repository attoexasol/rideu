import express from 'express';
import { asyncHandler } from '../../../middleware/error-handler';
import { requireAuth, extractUserInfo } from '../../../middleware/auth';
import { requireCustomer } from '../../../middleware/rbac';
import { paymentsConfigHandler, serviceAreaConfigHandler } from '../../../controllers/passengerBooking.controller';
import { serviceAreaQuerySchema, validate } from '../../../validators';

const router = express.Router();

router.get(
  '/payments',
  requireAuth,
  extractUserInfo,
  requireCustomer,
  asyncHandler(paymentsConfigHandler)
);

router.get(
  '/service-area',
  requireAuth,
  extractUserInfo,
  requireCustomer,
  validate(serviceAreaQuerySchema, 'query'),
  asyncHandler(serviceAreaConfigHandler)
);

export default router;
