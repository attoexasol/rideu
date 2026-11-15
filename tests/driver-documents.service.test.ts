import fs from 'fs';
import os from 'os';
import path from 'path';

const mockFind = jest.fn();
const mockList = jest.fn();
const mockUpsert = jest.fn();
const mockDriverExists = jest.fn();

jest.mock('../src/repositories/driverDocument.repository', () => ({
  findDriverDocument: (...args: unknown[]) => mockFind(...args),
  listDriverDocuments: (...args: unknown[]) => mockList(...args),
  upsertDriverDocument: (...args: unknown[]) => mockUpsert(...args),
  driverExists: (...args: unknown[]) => mockDriverExists(...args),
}));

import {
  listAdminDriverDocuments,
  resolveDocumentFile,
  resolveSignedDriverDocumentFile,
  uploadOrReplaceDriverDocument,
} from '../src/services/driverDocument.service';
import {
  createDocumentReadToken,
  savePrivateDocument,
} from '../src/services/driver-document-storage.service';

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);
const DRIVER_ID = '11111111-1111-4111-8111-111111111111';

describe('driver document service', () => {
  const tmp = path.join(os.tmpdir(), `rydu-driver-docs-svc-${Date.now()}`);

  beforeAll(() => {
    process.env.DRIVER_DOCUMENT_STORAGE_ROOT = tmp;
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-characters';
    fs.mkdirSync(tmp, { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockDriverExists.mockResolvedValue(true);
  });

  it('writes a new object then replaces the row without keeping a broken previous key', async () => {
    mockUpsert.mockImplementation(async (input: { storageKey: string }) => ({
      current: {
        id: 'doc-1',
        driverId: DRIVER_ID,
        documentType: 'driving_license',
        originalFilename: 'license.png',
        mimeType: 'image/png',
        sizeBytes: PNG_1x1.length,
        storageKey: input.storageKey,
        uploadedAt: new Date('2026-10-08T00:00:00.000Z'),
        createdAt: new Date('2026-10-08T00:00:00.000Z'),
        updatedAt: new Date('2026-10-08T00:00:00.000Z'),
      },
      previousStorageKey: null,
    }));

    const first = await uploadOrReplaceDriverDocument({
      driverId: DRIVER_ID,
      documentType: 'driving_license',
      buffer: PNG_1x1,
      declaredMime: 'image/png',
      originalFilename: '../../license.png',
    });
    expect(first.originalFilename).toBe('license.png');
    expect(first.documentType).toBe('driving_license');
    expect(first.downloadUrl).toContain('/api/v1/driver/documents/driving_license/content?token=');
    expect(first.downloadUrl).not.toContain('private-media');
    expect(mockUpsert).toHaveBeenCalledTimes(1);

    const previousKey = mockUpsert.mock.calls[0][0].storageKey;
    mockUpsert.mockImplementation(async (input: { storageKey: string }) => ({
      current: {
        id: 'doc-1',
        driverId: DRIVER_ID,
        documentType: 'driving_license',
        originalFilename: 'license.png',
        mimeType: 'image/png',
        sizeBytes: PNG_1x1.length,
        storageKey: input.storageKey,
        uploadedAt: new Date('2026-10-08T00:00:00.000Z'),
        createdAt: new Date('2026-10-08T00:00:00.000Z'),
        updatedAt: new Date('2026-10-08T00:00:00.000Z'),
      },
      previousStorageKey: previousKey,
    }));

    await uploadOrReplaceDriverDocument({
      driverId: DRIVER_ID,
      documentType: 'driving_license',
      buffer: PNG_1x1,
      declaredMime: 'image/png',
      originalFilename: 'license.png',
    });
    const nextKey = mockUpsert.mock.calls[1][0].storageKey;
    expect(nextKey).not.toBe(previousKey);
    expect(fs.existsSync(path.join(tmp, ...previousKey.split('/')))).toBe(false);
    expect(fs.existsSync(path.join(tmp, ...nextKey.split('/')))).toBe(true);
  });

  it('deletes the new object if the database write fails', async () => {
    mockUpsert.mockRejectedValue(new Error('db down'));
    await expect(
      uploadOrReplaceDriverDocument({
        driverId: DRIVER_ID,
        documentType: 'insurance',
        buffer: PNG_1x1,
        declaredMime: 'image/png',
        originalFilename: 'card.png',
      })
    ).rejects.toThrow('db down');
    const container = path.join(tmp, 'driver-documents', DRIVER_ID, 'insurance');
    const leftovers = fs.existsSync(container) ? fs.readdirSync(container) : [];
    expect(leftovers).toEqual([]);
  });

  it('does not allow token retrieval for another driver', async () => {
    const otherDriver = '33333333-3333-4333-8333-333333333333';
    const storageKey = `driver-documents/${DRIVER_ID}/insurance/x.png`;
    mockFind.mockImplementation(async (driverId: string) => {
      if (driverId !== DRIVER_ID) return null;
      return {
        id: 'doc-9',
        driverId: DRIVER_ID,
        documentType: 'insurance',
        originalFilename: 'card.png',
        mimeType: 'image/png',
        sizeBytes: 10,
        storageKey,
        uploadedAt: new Date(),
      };
    });
    const { token } = createDocumentReadToken({
      documentId: 'doc-9',
      driverId: DRIVER_ID,
      documentType: 'insurance',
      storageKey,
    });
    await expect(
      resolveDocumentFile({
        driverId: otherDriver,
        documentType: 'insurance',
        token,
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    mockFind.mockResolvedValue({
      id: 'doc-other',
      driverId: otherDriver,
      documentType: 'insurance',
      originalFilename: 'card.png',
      mimeType: 'image/png',
      sizeBytes: 10,
      storageKey: `driver-documents/${otherDriver}/insurance/y.png`,
      uploadedAt: new Date(),
    });
    await expect(
      resolveDocumentFile({
        driverId: otherDriver,
        documentType: 'insurance',
        token,
      })
    ).rejects.toMatchObject({ code: 'INVALID_DOCUMENT_READ_AUTHORIZATION' });
  });

  it('opens a valid signed token without a driver id in the path', async () => {
    const storageKey = `driver-documents/${DRIVER_ID}/insurance/view.png`;
    await savePrivateDocument(storageKey, PNG_1x1);
    mockFind.mockResolvedValue({
      id: 'doc-view',
      driverId: DRIVER_ID,
      documentType: 'insurance',
      originalFilename: 'card.png',
      mimeType: 'image/png',
      sizeBytes: PNG_1x1.length,
      storageKey,
      uploadedAt: new Date(),
    });
    const { token } = createDocumentReadToken({
      documentId: 'doc-view',
      driverId: DRIVER_ID,
      documentType: 'insurance',
      storageKey,
    });
    const file = await resolveSignedDriverDocumentFile({
      documentType: 'insurance',
      token,
    });
    expect(file.mimeType).toBe('image/png');
    expect(file.absolutePath).toContain('view.png');
  });

  it('rejects an expired or tampered signed token', async () => {
    const storageKey = `driver-documents/${DRIVER_ID}/insurance/old.png`;
    mockFind.mockResolvedValue({
      id: 'doc-old',
      driverId: DRIVER_ID,
      documentType: 'insurance',
      originalFilename: 'card.png',
      mimeType: 'image/png',
      sizeBytes: 10,
      storageKey,
      uploadedAt: new Date(),
    });
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const { token } = createDocumentReadToken({
      documentId: 'doc-old',
      driverId: DRIVER_ID,
      documentType: 'insurance',
      storageKey,
    });
    jest.setSystemTime(new Date('2026-01-01T00:10:00.000Z'));
    await expect(
      resolveSignedDriverDocumentFile({ documentType: 'insurance', token })
    ).rejects.toMatchObject({ code: 'INVALID_DOCUMENT_READ_AUTHORIZATION' });
    jest.useRealTimers();

    await expect(
      resolveSignedDriverDocumentFile({
        documentType: 'insurance',
        token: `${token}x`,
      })
    ).rejects.toMatchObject({ code: 'INVALID_DOCUMENT_READ_AUTHORIZATION' });
  });

  it('rejects a signed token used for a different document type', async () => {
    const storageKey = `driver-documents/${DRIVER_ID}/insurance/typed.png`;
    const { token } = createDocumentReadToken({
      documentId: 'doc-type',
      driverId: DRIVER_ID,
      documentType: 'insurance',
      storageKey,
    });
    await expect(
      resolveSignedDriverDocumentFile({ documentType: 'driving_license', token })
    ).rejects.toMatchObject({ code: 'INVALID_DOCUMENT_READ_AUTHORIZATION' });
    expect(mockFind).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND for unknown admin drivers', async () => {
    mockDriverExists.mockResolvedValue(false);
    await expect(listAdminDriverDocuments(DRIVER_ID)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      statusCode: 404,
    });
  });
});
