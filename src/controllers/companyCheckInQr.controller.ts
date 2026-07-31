import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { generateCompanyCheckInQrImage } from '../services/companyCheckInQr.service';
import { sendError, sendSuccess } from '../utils/response';

/**
 * GET /api/company/checkin/qrcode
 * Admin-only: generate the fixed COMPANY_CHECKIN QR code image.
 */
export async function getCompanyCheckInQrCodeHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<Response | void> {
  const formatParam = (req.query.format as string | undefined)?.toLowerCase();
  const format = formatParam === 'base64' ? 'base64' : 'png';

  try {
    const image = await generateCompanyCheckInQrImage(format);

    if (format === 'base64') {
      return sendSuccess(res, {
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
    res.setHeader('Content-Disposition', 'inline; filename="company-checkin-qrcode.png"');
    res.setHeader('X-Company-CheckIn-QR-Code', image.qrCode);
    res.status(200).send(image.pngBuffer);
  } catch (error) {
    console.error('[GET /api/company/checkin/qrcode] Error:', error);
    return sendError(
      res,
      'SERVER_ERROR',
      error instanceof Error ? error.message : 'Failed to generate company check-in QR',
      500
    );
  }
}
