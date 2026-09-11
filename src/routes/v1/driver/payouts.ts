import express from 'express';
import { asyncHandler } from '../../../middleware/error-handler';
import { requireAuth, extractUserInfo } from '../../../middleware/auth';
import { requireDriver } from '../../../middleware/rbac';
import { driverGeneralRateLimit } from '../../../middleware/rate-limiters';
import {
  createDriverOnboardingLinkHandler,
  getDriverPayoutStatusHandler,
} from '../../../controllers/driverPayout.controller';

const router = express.Router();
const driverAuth = [requireAuth, extractUserInfo, ...requireDriver];

router.post(
  '/onboarding-link',
  ...driverAuth,
  driverGeneralRateLimit,
  asyncHandler(createDriverOnboardingLinkHandler)
);

router.get(
  '/status',
  ...driverAuth,
  driverGeneralRateLimit,
  asyncHandler(getDriverPayoutStatusHandler)
);

export default router;
