import express from 'express';
import { asyncHandler } from '../../../middleware/error-handler';
import { requireAuth, extractUserInfo } from '../../../middleware/auth';
import { requireAdmin } from '../../../middleware/rbac';
import { validate } from '../../../validators';
import {
  adminMeterListQuerySchema,
  createRateScheduleSchema,
  meterSessionIdParamSchema,
  patchRateScheduleSchema,
  rateScheduleIdParamSchema,
} from '../../../validators/softMeter';
import {
  activateRateScheduleHandler,
  approveRateScheduleHandler,
  createRateScheduleHandler,
  getMeterSessionAdminHandler,
  getRateScheduleHandler,
  listMeterPaymentsHandler,
  listMeterReviewsHandler,
  listMeterSessionsHandler,
  listRateSchedulesHandler,
  patchRateScheduleHandler,
  retireRateScheduleHandler,
  submitRateScheduleHandler,
} from '../../../controllers/adminSoftMeter.controller';

const router = express.Router();
const adminAuth = [requireAuth, extractUserInfo, requireAdmin];

router.get('/rate-schedules', ...adminAuth, asyncHandler(listRateSchedulesHandler));
router.post(
  '/rate-schedules',
  ...adminAuth,
  validate(createRateScheduleSchema),
  asyncHandler(createRateScheduleHandler)
);
router.get(
  '/rate-schedules/:scheduleId',
  ...adminAuth,
  validate(rateScheduleIdParamSchema, 'params'),
  asyncHandler(getRateScheduleHandler)
);
router.patch(
  '/rate-schedules/:scheduleId',
  ...adminAuth,
  validate(rateScheduleIdParamSchema, 'params'),
  validate(patchRateScheduleSchema),
  asyncHandler(patchRateScheduleHandler)
);
router.post(
  '/rate-schedules/:scheduleId/submit',
  ...adminAuth,
  validate(rateScheduleIdParamSchema, 'params'),
  asyncHandler(submitRateScheduleHandler)
);
router.post(
  '/rate-schedules/:scheduleId/approve',
  ...adminAuth,
  validate(rateScheduleIdParamSchema, 'params'),
  asyncHandler(approveRateScheduleHandler)
);
router.post(
  '/rate-schedules/:scheduleId/activate',
  ...adminAuth,
  validate(rateScheduleIdParamSchema, 'params'),
  asyncHandler(activateRateScheduleHandler)
);
router.post(
  '/rate-schedules/:scheduleId/retire',
  ...adminAuth,
  validate(rateScheduleIdParamSchema, 'params'),
  asyncHandler(retireRateScheduleHandler)
);

router.get(
  '/sessions',
  ...adminAuth,
  validate(adminMeterListQuerySchema, 'query'),
  asyncHandler(listMeterSessionsHandler)
);
router.get(
  '/reviews',
  ...adminAuth,
  validate(adminMeterListQuerySchema, 'query'),
  asyncHandler(listMeterReviewsHandler)
);
router.get(
  '/sessions/:sessionId',
  ...adminAuth,
  validate(meterSessionIdParamSchema, 'params'),
  asyncHandler(getMeterSessionAdminHandler)
);
router.get(
  '/payments',
  ...adminAuth,
  validate(adminMeterListQuerySchema, 'query'),
  asyncHandler(listMeterPaymentsHandler)
);

export default router;
