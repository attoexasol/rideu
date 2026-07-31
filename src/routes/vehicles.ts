/**
 * Vehicle Routes (driver-scoped cab / vehicle QR)
 *
 * POST /api/vehicles/scan              - Scan vehicle QR → driver cab details
 * GET  /api/vehicles/:driverId/qrcode  - Vehicle QR image PNG/base64 (admin)
 */

import express from 'express';
import { requireAuth, extractUserInfo } from '../middleware/auth';
import {
  scanVehicleHandler,
  getDriverVehicleQrCodeImageHandler,
} from '../controllers/vehicleQrCode.controller';
import {
  validate,
  vehicleScanSchema,
  driverIdPathSchema,
  vehicleQrImageQuerySchema,
} from '../validators';
import { asyncHandler } from '../middleware/error-handler';

const router = express.Router();

router.post(
  '/scan',
  requireAuth,
  extractUserInfo,
  validate(vehicleScanSchema),
  asyncHandler(scanVehicleHandler)
);

router.get(
  '/:driverId/qrcode',
  requireAuth,
  extractUserInfo,
  validate(driverIdPathSchema, 'params'),
  validate(vehicleQrImageQuerySchema, 'query'),
  asyncHandler(getDriverVehicleQrCodeImageHandler)
);

export default router;
