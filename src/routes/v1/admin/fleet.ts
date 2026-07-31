import express from 'express';
import { asyncHandler } from '../../../middleware/error-handler';
import { requireAuth, extractUserInfo } from '../../../middleware/auth';
import { requireAdmin, requireRole } from '../../../middleware/rbac';
import { Auth0Roles } from '../../../config/auth0';
import {
  validate,
  fleetIdParamSchema,
  vehicleIdParamSchema,
  vehicleQrTokenIdParamSchema,
  driverIdPathSchema,
  assignDriverFleetSchema,
  forceEndDutySchema,
  listAdminFleetVehiclesQuerySchema,
  patchAdminFleetVehicleSchema,
} from '../../../validators';
import {
  listOrganizationsHandler,
  listFleetsHandler,
  listAdminFleetVehiclesHandler,
  listFleetVehiclesHandler,
  updateAdminFleetVehicleHandler,
  issueVehicleQrHandler,
  revokeVehicleQrHandler,
  rotateVehicleQrHandler,
  listVehicleQrTokensHandler,
  assignDriverFleetHandler,
  inspectDriverDutyHandler,
  inspectDriverAssignmentHandler,
  forceEndDutyHandler,
  ensurePlatformHandler,
} from '../../../controllers/adminFleet.controller';
import {
  adminListExchangesHandler,
  adminGetExchangeHandler,
  adminListExchangeEventsHandler,
  adminCancelExchangeHandler,
} from '../../../controllers/adminVehicleExchange.controller';

const router = express.Router();
const adminAuth = [requireAuth, extractUserInfo, requireAdmin];
const fleetVehicleListAuth = [
  requireAuth,
  extractUserInfo,
  requireRole([Auth0Roles.ADMIN, Auth0Roles.SUPER_ADMIN, Auth0Roles.FLEET_MANAGER]),
];

router.get('/organizations', ...adminAuth, asyncHandler(listOrganizationsHandler));
router.get('/fleets', ...adminAuth, asyncHandler(listFleetsHandler));
router.get(
  '/vehicles',
  ...fleetVehicleListAuth,
  validate(listAdminFleetVehiclesQuerySchema, 'query'),
  asyncHandler(listAdminFleetVehiclesHandler)
);

router.patch(
  '/vehicles/:vehicleId',
  ...fleetVehicleListAuth,
  validate(vehicleIdParamSchema, 'params'),
  validate(patchAdminFleetVehicleSchema),
  asyncHandler(updateAdminFleetVehicleHandler)
);

router.get(
  '/fleets/:fleetId/vehicles',
  ...adminAuth,
  validate(fleetIdParamSchema, 'params'),
  asyncHandler(listFleetVehiclesHandler)
);

router.post(
  '/vehicles/:vehicleId/qr/issue',
  ...adminAuth,
  validate(vehicleIdParamSchema, 'params'),
  asyncHandler(issueVehicleQrHandler)
);

router.post(
  '/vehicles/:vehicleId/qr/rotate',
  ...adminAuth,
  validate(vehicleIdParamSchema, 'params'),
  asyncHandler(rotateVehicleQrHandler)
);

router.get(
  '/vehicles/:vehicleId/qr/tokens',
  ...adminAuth,
  validate(vehicleIdParamSchema, 'params'),
  asyncHandler(listVehicleQrTokensHandler)
);

router.post(
  '/vehicle-qr-tokens/:tokenId/revoke',
  ...adminAuth,
  validate(vehicleQrTokenIdParamSchema, 'params'),
  asyncHandler(revokeVehicleQrHandler)
);

router.post(
  '/drivers/:driverId/fleet',
  ...adminAuth,
  validate(driverIdPathSchema, 'params'),
  validate(assignDriverFleetSchema),
  asyncHandler(assignDriverFleetHandler)
);

router.get(
  '/drivers/:driverId/duty',
  ...adminAuth,
  validate(driverIdPathSchema, 'params'),
  asyncHandler(inspectDriverDutyHandler)
);

router.get(
  '/drivers/:driverId/assignment',
  ...adminAuth,
  validate(driverIdPathSchema, 'params'),
  asyncHandler(inspectDriverAssignmentHandler)
);

router.post(
  '/drivers/:driverId/duty/force-end',
  ...adminAuth,
  validate(driverIdPathSchema, 'params'),
  validate(forceEndDutySchema),
  asyncHandler(forceEndDutyHandler)
);

router.post('/platform/ensure', ...adminAuth, asyncHandler(ensurePlatformHandler));

router.get('/vehicle-exchanges', ...adminAuth, asyncHandler(adminListExchangesHandler));
router.get(
  '/vehicle-exchanges/:id',
  ...adminAuth,
  asyncHandler(adminGetExchangeHandler)
);
router.get(
  '/vehicle-exchanges/:id/events',
  ...adminAuth,
  asyncHandler(adminListExchangeEventsHandler)
);
router.post(
  '/vehicle-exchanges/:id/cancel',
  ...adminAuth,
  asyncHandler(adminCancelExchangeHandler)
);

export default router;
