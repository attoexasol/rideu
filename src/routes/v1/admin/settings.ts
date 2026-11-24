import express from 'express';
import { asyncHandler } from '../../../middleware/error-handler';
import { requireAuth, extractUserInfo } from '../../../middleware/auth';
import { requireAdmin } from '../../../middleware/rbac';
import { requireRideVideoPermission } from '../../../middleware/rideVideoPermissions';
import { RideVideoPermissions } from '../../../constants/rideVideoPermissions';
import {
  updateSettlementSettingsSchema,
  updateVideoRecordingConfigSchema,
  validate,
} from '../../../validators';
import {
  getAdminSettlementSettingsHandler,
  patchAdminSettlementSettingsHandler,
} from '../../../controllers/adminSettlementSettings.controller';
import {
  getAdminVideoRecordingConfigHandler,
  patchAdminVideoRecordingConfigHandler,
} from '../../../controllers/videoRecordingConfig.controller';

const router = express.Router();
const adminAuth = [requireAuth, extractUserInfo, requireAdmin];

router.get('/settlement', ...adminAuth, asyncHandler(getAdminSettlementSettingsHandler));
router.patch(
  '/settlement',
  ...adminAuth,
  validate(updateSettlementSettingsSchema, 'body'),
  asyncHandler(patchAdminSettlementSettingsHandler)
);

router.get(
  '/video-recording',
  ...adminAuth,
  requireRideVideoPermission(RideVideoPermissions.VIEW),
  asyncHandler(getAdminVideoRecordingConfigHandler)
);
router.patch(
  '/video-recording',
  ...adminAuth,
  requireRideVideoPermission(RideVideoPermissions.MANAGE),
  validate(updateVideoRecordingConfigSchema, 'body'),
  asyncHandler(patchAdminVideoRecordingConfigHandler)
);

export default router;
