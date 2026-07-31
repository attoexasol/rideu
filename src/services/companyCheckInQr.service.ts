import { generateQrImage } from '../utils/qrImage';
import { getCompanyCheckInQrCodeValue } from '../repositories/companyCheckInQr.repository';

export interface CompanyCheckInQrImageResult {
  qrCode: string;
  format: 'png' | 'base64';
  pngBuffer?: Buffer;
  base64?: string;
  dataUrl?: string;
}

export async function generateCompanyCheckInQrImage(
  format: 'png' | 'base64' = 'png'
): Promise<CompanyCheckInQrImageResult> {
  const qrCode = getCompanyCheckInQrCodeValue();
  const image = await generateQrImage(qrCode, format);

  return {
    qrCode,
    format: image.format,
    pngBuffer: image.pngBuffer,
    base64: image.base64,
    dataUrl: image.dataUrl,
  };
}
