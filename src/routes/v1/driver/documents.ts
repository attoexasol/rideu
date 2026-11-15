import express, { NextFunction, Request, Response } from 'express';
import { asyncHandler } from '../../../middleware/error-handler';
import { requireAuth, extractUserInfo } from '../../../middleware/auth';
import { requireDriver } from '../../../middleware/rbac';
import { validate } from '../../../validators';
import { driverDocumentTypeParamSchema } from '../../../validators';
import {
  driverDocumentUploadMiddleware,
  handleDriverDocumentMulterError,
} from '../../../middleware/driverDocumentUpload';
import { driverDocumentUploadRateLimit } from '../../../middleware/rate-limiters';
import {
  downloadMyDocumentHandler,
  getMyDocumentHandler,
  listMyDocumentsHandler,
  streamSignedOwnDriverDocumentHandler,
  uploadMyDocumentHandler,
} from '../../../controllers/driverDocument.controller';

const router = express.Router();
const driverAuth = [requireAuth, extractUserInfo, ...requireDriver];

router.get('/', ...driverAuth, asyncHandler(listMyDocumentsHandler));

router.put(
  '/:documentType',
  ...driverAuth,
  driverDocumentUploadRateLimit,
  validate(driverDocumentTypeParamSchema, 'params'),
  (req, res, next) => {
    driverDocumentUploadMiddleware(req, res, (err) =>
      handleDriverDocumentMulterError(err, req, res, next)
    );
  },
  asyncHandler(uploadMyDocumentHandler)
);

router.get(
  '/:documentType',
  ...driverAuth,
  validate(driverDocumentTypeParamSchema, 'params'),
  asyncHandler(getMyDocumentHandler)
);

router.get(
  '/:documentType/content',
  validate(driverDocumentTypeParamSchema, 'params'),
  asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    if (typeof req.query.token === 'string' && req.query.token.length > 0) {
      await streamSignedOwnDriverDocumentHandler(req, res);
      return;
    }
    next();
  }),
  ...driverAuth,
  asyncHandler(downloadMyDocumentHandler)
);

export default router;
