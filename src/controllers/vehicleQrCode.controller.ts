import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import {
  generateDriverVehicleQrImage,
  scanDriverVehicleByQrCode,
} from '../services/vehicleQrCode.service';
import { findDriverVehicleById } from '../repositories/vehicleQrCode.repository';
import { sendError, sendNotFound, sendSuccess } from '../utils/response';
import { isAdmin } from '../middleware/rbac';

function canAccessDriverVehicleQr(req: AuthenticatedRequest): boolean {
  const user = (req as any).user;
  return Boolean(user && isAdmin(user.role));
}

/**
 * POST /api/vehicles/scan
 * Lookup driver vehicle details from a scanned vehicle QR code.
 */
export async function scanVehicleHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> {
  const { qrCode } = req.body;

  try {
    const result = await scanDriverVehicleByQrCode(qrCode);
    return sendSuccess(res, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to scan vehicle QR';
    const status = message.includes('not found') ? 404 : 400;
    return sendError(res, status === 404 ? 'NOT_FOUND' : 'VALIDATION_ERROR', message, status);
  }
}

/**
 * GET /api/vehicles/:driverId/qrcode
 * Generate vehicle QR image for a driver's cab (PNG or base64).
 */
export async function getDriverVehicleQrCodeImageHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<Response | void> {
  const { driverId } = req.params;
  const formatParam = (req.query.format as string | undefined)?.toLowerCase();
  const format = formatParam === 'base64' ? 'base64' : 'png';

  if (!canAccessDriverVehicleQr(req)) {
    return sendError(res, 'UNAUTHORIZED', 'Admin access required', 403);
  }

  const driver = await findDriverVehicleById(driverId);
  if (!driver) {
    return sendNotFound(res, 'Driver');
  }

  try {
    const image = await generateDriverVehicleQrImage(driverId, format);

    if (format === 'base64') {
      return sendSuccess(res, {
        driverId,
        qrCode: image.qrCode,
        format: 'base64',
        base64: image.base64,
        dataUrl: image.dataUrl,
      });
    }

    if (!image.pngBuffer) {
      return sendError(res, 'SERVER_ERROR', 'Failed to generate QR image', 500);
    }

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `inline; filename="vehicle-${driverId}-qrcode.png"`);
    res.setHeader('X-Vehicle-QR-Code', image.qrCode);
    res.status(200).send(image.pngBuffer);
  } catch (error) {
    return sendError(
      res,
      'SERVER_ERROR',
      error instanceof Error ? error.message : 'Failed to generate vehicle QR image',
      500
    );
  }
}
