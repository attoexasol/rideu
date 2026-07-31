import QRCode from 'qrcode';

export interface QrImageResult {
  format: 'png' | 'base64';
  pngBuffer?: Buffer;
  base64?: string;
  dataUrl?: string;
}

const QR_IMAGE_OPTIONS = {
  width: 300,
  margin: 2,
  errorCorrectionLevel: 'M' as const,
};

/**
 * Generate a QR code image from arbitrary text content.
 * Uses the same options as vehicle/driver QR image generation.
 */
export async function generateQrImage(
  content: string,
  format: 'png' | 'base64' = 'png'
): Promise<QrImageResult> {
  if (format === 'base64') {
    const dataUrl = await QRCode.toDataURL(content, {
      type: 'image/png',
      ...QR_IMAGE_OPTIONS,
    });
    return {
      format: 'base64',
      base64: dataUrl.replace(/^data:image\/png;base64,/, ''),
      dataUrl,
    };
  }

  const pngBuffer = await QRCode.toBuffer(content, {
    type: 'png',
    ...QR_IMAGE_OPTIONS,
  });

  return { format: 'png', pngBuffer };
}
