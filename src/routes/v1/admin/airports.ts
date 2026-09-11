import express from 'express';
import { asyncHandler } from '../../../middleware/error-handler';
import { requireAuth, extractUserInfo } from '../../../middleware/auth';
import { requireAdmin } from '../../../middleware/rbac';
import {
  airportIdParamSchema,
  createAirportSchema,
  updateAirportSchema,
  validate,
} from '../../../validators';
import {
  createAdminAirportHandler,
  getAdminAirportHandler,
  listAdminAirportsHandler,
  patchAdminAirportHandler,
} from '../../../controllers/adminAirport.controller';

const router = express.Router();
const adminAuth = [requireAuth, extractUserInfo, requireAdmin];

router.get('/', ...adminAuth, asyncHandler(listAdminAirportsHandler));
router.post(
  '/',
  ...adminAuth,
  validate(createAirportSchema, 'body'),
  asyncHandler(createAdminAirportHandler)
);
router.get(
  '/:id',
  ...adminAuth,
  validate(airportIdParamSchema, 'params'),
  asyncHandler(getAdminAirportHandler)
);
router.patch(
  '/:id',
  ...adminAuth,
  validate(airportIdParamSchema, 'params'),
  validate(updateAirportSchema, 'body'),
  asyncHandler(patchAdminAirportHandler)
);

export default router;
