import express from 'express';
import { asyncHandler } from '../../../middleware/error-handler';
import { requireAuth, extractUserInfo } from '../../../middleware/auth';
import { requireAdmin } from '../../../middleware/rbac';
import { validate } from '../../../validators';
import {
  adminPassengerIdParamSchema,
  adminPassengerListQuerySchema,
} from '../../../validators/profile';
import {
  getAdminPassengerHandler,
  listAdminPassengersHandler,
} from '../../../controllers/profile.controller';

const router = express.Router();
const adminAuth = [requireAuth, extractUserInfo, requireAdmin];

router.get(
  '/',
  ...adminAuth,
  validate(adminPassengerListQuerySchema, 'query'),
  asyncHandler(listAdminPassengersHandler)
);
router.get(
  '/:id',
  ...adminAuth,
  validate(adminPassengerIdParamSchema, 'params'),
  asyncHandler(getAdminPassengerHandler)
);

export default router;
