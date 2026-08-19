import express from 'express';
import { asyncHandler } from '../../../middleware/error-handler';
import { requireAuth, extractUserInfo } from '../../../middleware/auth';
import { requireCustomer } from '../../../middleware/rbac';
import { validate, registerPassengerPushTokenSchema } from '../../../validators';
import { passengerRecoveryRateLimit } from '../../../middleware/rate-limiters';
import {
  registerPassengerPushTokenHandler,
  unregisterPassengerPushTokenHandler,
} from '../../../controllers/passengerPush.controller';

const router = express.Router();
const passengerAuth = [requireAuth, extractUserInfo, requireCustomer, passengerRecoveryRateLimit];

router.put(
  '/',
  ...passengerAuth,
  validate(registerPassengerPushTokenSchema),
  asyncHandler(registerPassengerPushTokenHandler)
);

router.delete('/', ...passengerAuth, asyncHandler(unregisterPassengerPushTokenHandler));

export default router;
