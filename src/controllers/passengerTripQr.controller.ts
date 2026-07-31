import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import {
  generatePassengerQrForTrip,
  generatePassengerQrImage,
  scanPassengerQr,
} from '../services/passengerTripQr.service';
import { canActOnDriver } from '../utils/driverAccess';
import { sendError, sendNotFound, sendSuccess } from '../utils/response';
import { isAdmin } from '../middleware/rbac';

function canManageTripQr(req: AuthenticatedRequest): boolean {
  const user = (req as any).user;
  return Boolean(user && isAdmin(user.role));
}

/**
 * POST /api/trips/:tripId/generate-qr
 */
export async function generatePassengerQrHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> {
  const { tripId } = req.params;

  if (!canManageTripQr(req)) {
    return sendError(res, 'UNAUTHORIZED', 'Admin access required', 403);
  }

  try {
    const result = await generatePassengerQrForTrip(tripId);
    return sendSuccess(res, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to generate passenger QR';
    const status = message === 'Trip not found' ? 404 : 500;
    return sendError(res, status === 404 ? 'NOT_FOUND' : 'SERVER_ERROR', message, status);
  }
}

/**
 * GET /api/trips/:tripId/qrcode
 */
export async function getPassengerQrCodeImageHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<Response | void> {
  const { tripId } = req.params;
  const formatParam = (req.query.format as string | undefined)?.toLowerCase();
  const format = formatParam === 'base64' ? 'base64' : 'png';

  if (!canManageTripQr(req)) {
    return sendError(res, 'UNAUTHORIZED', 'Admin access required', 403);
  }

  try {
    const image = await generatePassengerQrImage(tripId, format);

    if (format === 'base64') {
      return sendSuccess(res, {
        tripId: image.tripId,
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
    res.setHeader('Content-Disposition', `inline; filename="trip-${tripId}-passenger-qrcode.png"`);
    res.setHeader('X-Trip-Passenger-QR-Code', image.qrCode);
    res.status(200).send(image.pngBuffer);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to generate passenger QR image';
    if (message === 'Trip not found') {
      return sendNotFound(res, 'Trip');
    }
    if (message.includes('has not been generated')) {
      return sendError(res, 'VALIDATION_ERROR', message, 400);
    }
    console.error('[GET /api/trips/:tripId/qrcode] Error:', error);
    return sendError(res, 'SERVER_ERROR', message, 500);
  }
}

/**
 * POST /api/trips/scan-passenger
 */
export async function scanPassengerHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> {
  const { driverId, qrCode } = req.body;

  const access = await canActOnDriver(req, driverId);
  if (!access.driver) {
    return sendNotFound(res, 'Driver');
  }
  if (!access.allowed) {
    return sendError(res, 'UNAUTHORIZED', 'You cannot verify pickup for this driver', 403);
  }

  try {
    const result = await scanPassengerQr(driverId, qrCode);
    return sendSuccess(res, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to verify passenger QR';
    let status = 400;
    if (message === 'Trip not found') status = 404;
    if (message.includes('does not belong')) status = 403;
    return sendError(
      res,
      status === 404 ? 'NOT_FOUND' : status === 403 ? 'UNAUTHORIZED' : 'VALIDATION_ERROR',
      message,
      status
    );
  }
}
