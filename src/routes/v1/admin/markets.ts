import express from 'express';
import { asyncHandler } from '../../../middleware/error-handler';
import { requireAuth, extractUserInfo } from '../../../middleware/auth';
import { requireAdmin } from '../../../middleware/rbac';
import { marketCodeParamSchema, upsertMarketFaresSchema, validate } from '../../../validators';
import {
  getAdminMarketFaresHandler,
  listAdminMarketsHandler,
  putAdminMarketFaresHandler,
} from '../../../controllers/adminMarket.controller';

const router = express.Router();
const adminAuth = [requireAuth, extractUserInfo, requireAdmin];

router.get('/', ...adminAuth, asyncHandler(listAdminMarketsHandler));
router.get(
  '/:code/fares',
  ...adminAuth,
  validate(marketCodeParamSchema, 'params'),
  asyncHandler(getAdminMarketFaresHandler)
);
router.put(
  '/:code/fares',
  ...adminAuth,
  validate(marketCodeParamSchema, 'params'),
  validate(upsertMarketFaresSchema, 'body'),
  asyncHandler(putAdminMarketFaresHandler)
);

export default router;
