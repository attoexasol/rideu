/**
 * Company Routes
 *
 * GET /api/company/checkin/qrcode - Generate COMPANY_CHECKIN QR (admin, PNG/base64)
 */

import express from 'express';
import { requireAuth, extractUserInfo } from '../middleware/auth';
import { requireAdmin } from '../middleware/rbac';
import { getCompanyCheckInQrCodeHandler } from '../controllers/companyCheckInQr.controller';
import { validate, companyCheckInQrQuerySchema } from '../validators';
import { asyncHandler } from '../middleware/error-handler';

const router = express.Router();

router.get(
  '/checkin/qrcode',
  requireAuth,
  extractUserInfo,
  requireAdmin,
  validate(companyCheckInQrQuerySchema, 'query'),
  asyncHandler(getCompanyCheckInQrCodeHandler)
);

export default router;
