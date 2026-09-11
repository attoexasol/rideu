import express from 'express';
import { asyncHandler } from '../../../middleware/error-handler';
import { requireAuth, extractUserInfo } from '../../../middleware/auth';
import { requireAdmin } from '../../../middleware/rbac';
import { updateSettlementSettingsSchema, validate } from '../../../validators';
import {
  getAdminSettlementSettingsHandler,
  patchAdminSettlementSettingsHandler,
} from '../../../controllers/adminSettlementSettings.controller';

const router = express.Router();
const adminAuth = [requireAuth, extractUserInfo, requireAdmin];

router.get('/settlement', ...adminAuth, asyncHandler(getAdminSettlementSettingsHandler));
router.patch(
  '/settlement',
  ...adminAuth,
  validate(updateSettlementSettingsSchema, 'body'),
  asyncHandler(patchAdminSettlementSettingsHandler)
);

export default router;
