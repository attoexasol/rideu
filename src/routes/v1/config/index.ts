import express from 'express';
import { asyncHandler } from '../../../middleware/error-handler';
import { requireAuth, extractUserInfo } from '../../../middleware/auth';
import { requireCustomer } from '../../../middleware/rbac';
import { paymentsConfigHandler } from '../../../controllers/passengerBooking.controller';

const router = express.Router();

router.get(
  '/payments',
  requireAuth,
  extractUserInfo,
  requireCustomer,
  asyncHandler(paymentsConfigHandler)
);

export default router;
