import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { findDriverForQrAccess } from '../repositories/driverQrCode.repository';
import { generateDriverQrImage, scanDriverByQrCode } from '../services/driverQrCode.service';
import { sendError, sendNotFound, sendSuccess } from '../utils/response';
import { isValidDriverQrCode } from '../utils/driverQrCode';

function canAccessDriverQrImage(
  req: AuthenticatedRequest,
  driverId: string,
  driverAuth0Id: string
): boolean {
  const user = (req as any).user;
  if (!user) {
    return false;
  }

  const role = user.role?.toLowerCase();
  if (role === 'admin' || role === 'super_admin') {
    return true;
  }

  if (role === 'driver' && user.auth0Id === driverAuth0Id) {
    return true;
  }

  if (role === 'driver' && user.userId === driverId) {
    return true;
  }

  return false;
}

/**
 * GET /api/drivers/qr/:qrCode
 */
export async function getDriverByQrCodeHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> {
  const { qrCode } = req.params;

  if (!qrCode?.trim()) {
    return sendError(res, 'VALIDATION_ERROR', 'QR code is required', 400);
  }

  const decodedQrCode = decodeURIComponent(qrCode.trim());

  if (!isValidDriverQrCode(decodedQrCode)) {
    return sendError(res, 'VALIDATION_ERROR', 'Invalid QR code format', 400);
  }

  try {
    const driver = await scanDriverByQrCode(decodedQrCode);

    if (!driver) {
      return sendNotFound(res, 'Driver');
    }

    return sendSuccess(res, driver);
  } catch (error) {
    console.error('[GET /api/drivers/qr/:qrCode] Error:', error);
    return sendError(
      res,
      'SERVER_ERROR',
      error instanceof Error ? error.message : 'Failed to lookup driver by QR code',
      500
    );
  }
}

/**
 * GET /api/drivers/:id/qrcode
 * Query: format=png|base64 (default png)
 */
export async function getDriverQrCodeImageHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<Response | void> {
  const { id } = req.params;
  const formatParam = (req.query.format as string | undefined)?.toLowerCase();

  if (!id?.trim()) {
    return sendError(res, 'VALIDATION_ERROR', 'Driver ID is required', 400);
  }

  if (formatParam && formatParam !== 'png' && formatParam !== 'base64') {
    return sendError(res, 'VALIDATION_ERROR', 'format must be png or base64', 400);
  }

  const format = formatParam === 'base64' ? 'base64' : 'png';

  try {
    const driver = await findDriverForQrAccess(id);

    if (!driver) {
      return sendNotFound(res, 'Driver');
    }

    if (!canAccessDriverQrImage(req, id, driver.auth0Id)) {
      return sendError(
        res,
        'UNAUTHORIZED',
        'You do not have permission to access this QR code',
        403
      );
    }

    const image = await generateDriverQrImage(id, format);

    if (format === 'base64') {
      return sendSuccess(res, {
        driverId: id,
        qrCode: image.qrCode,
        format: 'base64',
        base64: image.base64,
        dataUrl: image.dataUrl,
      });
    }

    if (!image.pngBuffer) {
      return sendError(res, 'SERVER_ERROR', 'Failed to generate QR code image', 500);
    }

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `inline; filename="driver-${id}-qrcode.png"`);
    res.setHeader('X-Driver-QR-Code', image.qrCode);
    res.status(200).send(image.pngBuffer);
  } catch (error) {
    console.error('[GET /api/drivers/:id/qrcode] Error:', error);
    return sendError(
      res,
      'SERVER_ERROR',
      error instanceof Error ? error.message : 'Failed to generate QR code image',
      500
    );
  }
}
