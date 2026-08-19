import express from 'express';
import { asyncHandler } from '../../../middleware/error-handler';
import { requireAuth, extractUserInfo } from '../../../middleware/auth';
import { requireDriver } from '../../../middleware/rbac';
import { validate } from '../../../validators';
import { profileDeactivateSchema, profilePatchSchema } from '../../../validators/profile';
import { avatarUploadMiddleware, handleAvatarMulterError } from '../../../middleware/avatarUpload';
import {
  profilePatchRateLimit,
  avatarUploadRateLimit,
  profileDeactivateRateLimit,
} from '../../../middleware/rate-limiters';
import {
  getDriverProfileHandler,
  patchDriverProfileHandler,
  uploadDriverAvatarHandler,
  deleteDriverAvatarHandler,
  deactivateDriverHandler,
} from '../../../controllers/profile.controller';

const router = express.Router();
const driverAuth = [requireAuth, extractUserInfo, ...requireDriver];

router.get('/', ...driverAuth, asyncHandler(getDriverProfileHandler));
router.patch(
  '/',
  ...driverAuth,
  profilePatchRateLimit,
  validate(profilePatchSchema),
  asyncHandler(patchDriverProfileHandler)
);
router.post(
  '/avatar',
  ...driverAuth,
  avatarUploadRateLimit,
  (req, res, next) => {
    avatarUploadMiddleware(req, res, (err) => handleAvatarMulterError(err, req, res, next));
  },
  asyncHandler(uploadDriverAvatarHandler)
);
router.delete('/avatar', ...driverAuth, asyncHandler(deleteDriverAvatarHandler));
router.post(
  '/deactivate',
  ...driverAuth,
  profileDeactivateRateLimit,
  validate(profileDeactivateSchema),
  asyncHandler(deactivateDriverHandler)
);

export default router;
