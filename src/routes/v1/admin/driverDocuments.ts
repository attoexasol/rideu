import express, { NextFunction, Request, Response } from 'express';
import { asyncHandler } from '../../../middleware/error-handler';
import { requireAuth, extractUserInfo } from '../../../middleware/auth';
import { requireAdmin } from '../../../middleware/rbac';
import { validate, driverIdPathSchema, adminDriverDocumentParamSchema } from '../../../validators';
import { adminDriverDocumentRateLimit } from '../../../middleware/rate-limiters';
import {
  adminDownloadDriverDocumentHandler,
  adminGetDriverDocumentHandler,
  adminListDriverDocumentsHandler,
  streamSignedDriverDocumentHandler,
} from '../../../controllers/driverDocument.controller';

const router = express.Router({ mergeParams: true });
const adminAuth = [requireAuth, extractUserInfo, requireAdmin];

router.get(
  '/',
  ...adminAuth,
  adminDriverDocumentRateLimit,
  validate(driverIdPathSchema, 'params'),
  asyncHandler(adminListDriverDocumentsHandler)
);

router.get(
  '/:documentType',
  ...adminAuth,
  adminDriverDocumentRateLimit,
  validate(adminDriverDocumentParamSchema, 'params'),
  asyncHandler(adminGetDriverDocumentHandler)
);

router.get(
  '/:documentType/content',
  adminDriverDocumentRateLimit,
  validate(adminDriverDocumentParamSchema, 'params'),
  asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    if (typeof req.query.token === 'string' && req.query.token.length > 0) {
      await streamSignedDriverDocumentHandler(req, res);
      return;
    }
    next();
  }),
  ...adminAuth,
  asyncHandler(adminDownloadDriverDocumentHandler)
);

export default router;
