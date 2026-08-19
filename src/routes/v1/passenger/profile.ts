import express from 'express';
import { asyncHandler } from '../../../middleware/error-handler';
import { requireAuth, extractUserInfo } from '../../../middleware/auth';
import { requireCustomer } from '../../../middleware/rbac';
import { validate } from '../../../validators';
import { profileDeactivateSchema, profilePatchSchema } from '../../../validators/profile';
import { avatarUploadMiddleware, handleAvatarMulterError } from '../../../middleware/avatarUpload';
import {
  profilePatchRateLimit,
  avatarUploadRateLimit,
  profileDeactivateRateLimit,
} from '../../../middleware/rate-limiters';
import {
  getPassengerProfileHandler,
  patchPassengerProfileHandler,
  uploadPassengerAvatarHandler,
  deletePassengerAvatarHandler,
  deactivatePassengerHandler,
} from '../../../controllers/profile.controller';

const router = express.Router();
const passengerAuth = [requireAuth, extractUserInfo, requireCustomer];

router.get('/', ...passengerAuth, asyncHandler(getPassengerProfileHandler));
router.patch(
  '/',
  ...passengerAuth,
  profilePatchRateLimit,
  validate(profilePatchSchema),
  asyncHandler(patchPassengerProfileHandler)
);
router.post(
  '/avatar',
  ...passengerAuth,
  avatarUploadRateLimit,
  (req, res, next) => {
    avatarUploadMiddleware(req, res, (err) => handleAvatarMulterError(err, req, res, next));
  },
  asyncHandler(uploadPassengerAvatarHandler)
);
router.delete('/avatar', ...passengerAuth, asyncHandler(deletePassengerAvatarHandler));
router.post(
  '/deactivate',
  ...passengerAuth,
  profileDeactivateRateLimit,
  validate(profileDeactivateSchema),
  asyncHandler(deactivatePassengerHandler)
);

export default router;
