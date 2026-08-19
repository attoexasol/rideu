import express from 'express';
import { asyncHandler } from '../../../middleware/error-handler';
import { requireAuth, extractUserInfo } from '../../../middleware/auth';
import { requireDriver } from '../../../middleware/rbac';
import { validate, registerDriverPushTokenSchema } from '../../../validators';
import {
  registerPushTokenHandler,
  unregisterPushTokenHandler,
} from '../../../controllers/driverPush.controller';

const router = express.Router();
const driverAuth = [requireAuth, extractUserInfo, ...requireDriver];

router.put(
  '/',
  ...driverAuth,
  validate(registerDriverPushTokenSchema),
  asyncHandler(registerPushTokenHandler)
);

router.delete('/', ...driverAuth, asyncHandler(unregisterPushTokenHandler));

export default router;
