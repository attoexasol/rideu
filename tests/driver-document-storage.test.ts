import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import {
  assertDocumentBuffer,
  createDocumentReadToken,
  createDocumentStorageKey,
  deletePrivateDocument,
  detectDocumentKind,
  inspectPrivateDocument,
  savePrivateDocument,
  sanitizeOriginalFilename,
  verifyDocumentReadToken,
} from '../src/services/driver-document-storage.service';
import { driverDocumentConfig } from '../src/config/driverDocuments';

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF');

const DRIVER_ID = '11111111-1111-4111-8111-111111111111';

describe('driver document detection', () => {
  it('detects pdf/jpeg/png magic bytes', async () => {
    const jpeg = await sharp(PNG_1x1).jpeg().toBuffer();
    expect(detectDocumentKind(PDF)).toBe('pdf');
    expect(detectDocumentKind(PNG_1x1)).toBe('png');
    expect(detectDocumentKind(jpeg)).toBe('jpeg');
  });

  it('rejects MIME/signature mismatch', async () => {
    expect(() => assertDocumentBuffer(PNG_1x1, 'application/pdf')).toThrow(/does not match/);
    expect(() => assertDocumentBuffer(PDF, 'image/jpeg')).toThrow(/does not match/);
  });

  it('rejects unsupported and malformed files', () => {
    const mp4 = Buffer.alloc(32, 0);
    mp4.write('ftyp', 4, 'ascii');
    expect(() => assertDocumentBuffer(mp4, 'video/mp4')).toThrow(/Only PDF, JPEG, and PNG/);
    expect(() => assertDocumentBuffer(Buffer.from('not-a-document'), 'application/pdf')).toThrow(
      /not a valid/
    );
  });

  it('rejects oversized buffers', () => {
    const huge = Buffer.alloc(driverDocumentConfig.maxBytes + 1);
    huge[0] = 0x25;
    huge[1] = 0x50;
    huge[2] = 0x44;
    huge[3] = 0x46;
    expect(() => assertDocumentBuffer(huge, 'application/pdf')).toThrow(/exceeds/);
  });
});

describe('filename sanitization', () => {
  it('strips path traversal and unsafe characters', () => {
    expect(sanitizeOriginalFilename('../../etc/passwd', 'pdf')).toBe('passwd.pdf');
    expect(sanitizeOriginalFilename('my license (1).PDF', 'pdf')).toBe('my_license_1_.pdf');
    expect(sanitizeOriginalFilename('', 'png')).toBe('document.png');
  });
});

describe('private document storage', () => {
  const tmp = path.join(os.tmpdir(), `rydu-driver-docs-${Date.now()}`);

  beforeAll(() => {
    process.env.DRIVER_DOCUMENT_STORAGE_ROOT = tmp;
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-characters';
    fs.mkdirSync(tmp, { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('writes under the private container and rejects path traversal keys', async () => {
    const key = createDocumentStorageKey({
      driverId: DRIVER_ID,
      documentType: 'driving_license',
      extension: 'pdf',
    });
    expect(key.startsWith('driver-documents/')).toBe(true);
    expect(key.includes('..')).toBe(false);
    await savePrivateDocument(key, PDF);
    const inspected = await inspectPrivateDocument(key);
    expect(inspected?.fileSizeBytes).toBe(PDF.length);
    await expect(inspectPrivateDocument('../etc/passwd')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      inspectPrivateDocument('ride-recordings/abc/secret.mp4')
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('signs and verifies short-lived read tokens bound to the document', () => {
    const key = `driver-documents/${DRIVER_ID}/insurance/doc.pdf`;
    const { token, expiresAt } = createDocumentReadToken({
      documentId: '22222222-2222-4222-8222-222222222222',
      driverId: DRIVER_ID,
      documentType: 'insurance',
      storageKey: key,
    });
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    verifyDocumentReadToken(token, {
      documentId: '22222222-2222-4222-8222-222222222222',
      driverId: DRIVER_ID,
      documentType: 'insurance',
      storageKey: key,
    });
    expect(() =>
      verifyDocumentReadToken(token, {
        documentId: '22222222-2222-4222-8222-222222222222',
        driverId: '33333333-3333-4333-8333-333333333333',
        documentType: 'insurance',
        storageKey: key,
      })
    ).toThrow(/Invalid document read token/);
  });

  it('deletes replaced objects without leaving the previous file', async () => {
    const first = createDocumentStorageKey({
      driverId: DRIVER_ID,
      documentType: 'insurance',
      extension: 'png',
    });
    const second = createDocumentStorageKey({
      driverId: DRIVER_ID,
      documentType: 'insurance',
      extension: 'png',
    });
    await savePrivateDocument(first, PNG_1x1);
    await savePrivateDocument(second, PNG_1x1);
    await deletePrivateDocument(first);
    expect(await inspectPrivateDocument(first)).toBeNull();
    expect(await inspectPrivateDocument(second)).not.toBeNull();
  });
});
