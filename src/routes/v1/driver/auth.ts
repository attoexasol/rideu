import express from 'express';
import { asyncHandler } from '../../../middleware/error-handler';
import { authRateLimiter } from '../../../middleware/rate-limiters';
import { validate, driverSelfRegisterSchema } from '../../../validators';
import { registerDriverHandler } from '../../../controllers/driverAuth.controller';

const router = express.Router();

router.post(
  '/register',
  authRateLimiter,
  validate(driverSelfRegisterSchema),
  asyncHandler(registerDriverHandler)
);

export default router;
