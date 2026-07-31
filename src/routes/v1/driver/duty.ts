import express from 'express';
import { asyncHandler } from '../../../middleware/error-handler';
import { requireAuth, extractUserInfo } from '../../../middleware/auth';
import { requireDriver } from '../../../middleware/rbac';
import { validate, dutyStartSchema, dutyEndSchema } from '../../../validators';
import {
  dutyStartHandler,
  dutyEndHandler,
  dutyCurrentHandler,
  dutyCurrentVehicleQrHandler,
} from '../../../controllers/duty.controller';

const router = express.Router();
const driverAuth = [requireAuth, extractUserInfo, ...requireDriver];

router.post('/start', ...driverAuth, validate(dutyStartSchema), asyncHandler(dutyStartHandler));
router.post('/end', ...driverAuth, validate(dutyEndSchema), asyncHandler(dutyEndHandler));
router.get('/current/vehicle-qr', ...driverAuth, asyncHandler(dutyCurrentVehicleQrHandler));
router.get('/current', ...driverAuth, asyncHandler(dutyCurrentHandler));

export default router;
