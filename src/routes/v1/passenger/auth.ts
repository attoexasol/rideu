import express from 'express';
import { asyncHandler } from '../../../middleware/error-handler';
import { requireAuth, extractUserInfo } from '../../../middleware/auth';
import { requireCustomer } from '../../../middleware/rbac';
import {
  validate,
  passengerRegisterSchema,
  passengerLoginSchema,
  passengerForgotPasswordSchema,
} from '../../../validators';
import {
  registerHandler,
  loginHandler,
  logoutHandler,
  meHandler,
  forgotPasswordHandler,
} from '../../../controllers/passengerAuth.controller';

const router = express.Router();

router.post('/register', validate(passengerRegisterSchema), asyncHandler(registerHandler));
router.post('/login', validate(passengerLoginSchema), asyncHandler(loginHandler));
router.post(
  '/forgot-password',
  validate(passengerForgotPasswordSchema),
  asyncHandler(forgotPasswordHandler)
);

router.post('/logout', requireAuth, extractUserInfo, requireCustomer, asyncHandler(logoutHandler));
router.get('/me', requireAuth, extractUserInfo, requireCustomer, asyncHandler(meHandler));

export default router;
