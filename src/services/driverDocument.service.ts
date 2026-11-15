import {
  DRIVER_DOCUMENT_TYPES,
  type DriverDocumentType,
} from '../config/driverDocuments';
import type { DriverDocument } from '../db/schema/driver_documents';
import {
  driverExists,
  findDriverDocument,
  listDriverDocuments,
  upsertDriverDocument,
} from '../repositories/driverDocument.repository';
import {
  assertDocumentBuffer,
  createDocumentReadToken,
  createDocumentStorageKey,
  deletePrivateDocument,
  inspectPrivateDocument,
  savePrivateDocument,
  sanitizeOriginalFilename,
  toSignedDocumentUrl,
  readDocumentReadToken,
  verifyDocumentReadToken,
  DriverDocumentStorageError,
} from './driver-document-storage.service';

export class DriverDocumentError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400
  ) {
    super(message);
    this.name = 'DriverDocumentError';
  }
}

export interface DriverDocumentMetadataDto {
  id: string;
  documentType: DriverDocumentType;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  downloadUrl: string;
  downloadUrlExpiresAt: string;
}

export interface DriverDocumentMapDto {
  driving_license: DriverDocumentMetadataDto | null;
  insurance: DriverDocumentMetadataDto | null;
}

function contentPath(audience: 'driver' | 'admin', driverId: string, documentType: DriverDocumentType): string {
  if (audience === 'admin') {
    return `/api/v1/admin/fleet/drivers/${driverId}/documents/${documentType}/content`;
  }
  return `/api/v1/driver/documents/${documentType}/content`;
}

function toMetadata(
  row: DriverDocument,
  audience: 'driver' | 'admin'
): DriverDocumentMetadataDto {
  const authorization = createDocumentReadToken({
    documentId: row.id,
    driverId: row.driverId,
    documentType: row.documentType as DriverDocumentType,
    storageKey: row.storageKey,
  });
  const relative = `${contentPath(audience, row.driverId, row.documentType as DriverDocumentType)}?token=${authorization.token}`;
  return {
    id: row.id,
    documentType: row.documentType as DriverDocumentType,
    originalFilename: row.originalFilename,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    uploadedAt: row.uploadedAt.toISOString(),
    downloadUrl: toSignedDocumentUrl(relative),
    downloadUrlExpiresAt: authorization.expiresAt.toISOString(),
  };
}

function emptyMap(): DriverDocumentMapDto {
  return { driving_license: null, insurance: null };
}

function toMap(rows: DriverDocument[], audience: 'driver' | 'admin'): DriverDocumentMapDto {
  const map = emptyMap();
  for (const row of rows) {
    if (row.documentType === 'driving_license' || row.documentType === 'insurance') {
      map[row.documentType] = toMetadata(row, audience);
    }
  }
  return map;
}

export async function listDocumentsForDriver(
  driverId: string,
  audience: 'driver' | 'admin'
): Promise<DriverDocumentMapDto> {
  const rows = await listDriverDocuments(driverId);
  return toMap(rows, audience);
}

export async function getDocumentMetadataForDriver(
  driverId: string,
  documentType: DriverDocumentType,
  audience: 'driver' | 'admin'
): Promise<DriverDocumentMetadataDto> {
  const row = await findDriverDocument(driverId, documentType);
  if (!row) {
    throw new DriverDocumentError('NOT_FOUND', 'Document not found', 404);
  }
  return toMetadata(row, audience);
}

export async function uploadOrReplaceDriverDocument(params: {
  driverId: string;
  documentType: DriverDocumentType;
  buffer: Buffer;
  declaredMime?: string;
  originalFilename?: string;
}): Promise<DriverDocumentMetadataDto> {
  const detected = assertDocumentBuffer(params.buffer, params.declaredMime);
  const originalFilename = sanitizeOriginalFilename(params.originalFilename, detected.extension);
  const storageKey = createDocumentStorageKey({
    driverId: params.driverId,
    documentType: params.documentType,
    extension: detected.extension,
  });

  try {
    await savePrivateDocument(storageKey, params.buffer);
  } catch {
    throw new DriverDocumentError(
      'DOCUMENT_STORAGE_ERROR',
      'Unable to store document',
      500
    );
  }

  let upserted: { current: DriverDocument; previousStorageKey: string | null };
  try {
    upserted = await upsertDriverDocument({
      driverId: params.driverId,
      documentType: params.documentType,
      originalFilename,
      mimeType: detected.mimeType,
      sizeBytes: params.buffer.length,
      storageKey,
    });
  } catch (error) {
    await deletePrivateDocument(storageKey).catch(() => undefined);
    throw error;
  }

  if (upserted.previousStorageKey && upserted.previousStorageKey !== storageKey) {
    await deletePrivateDocument(upserted.previousStorageKey).catch((error) => {
      console.warn('[driver-documents] previous object cleanup failed', {
        driverId: params.driverId,
        documentType: params.documentType,
        code: (error as NodeJS.ErrnoException)?.code,
      });
    });
  }

  console.info('[driver-documents] uploaded', {
    driverId: params.driverId,
    documentType: params.documentType,
    mimeType: detected.mimeType,
    sizeBytes: params.buffer.length,
  });

  return toMetadata(upserted.current, 'driver');
}

/**
 * Browser open of downloadUrl. The signed token carries the driver id;
 * the path has only the document type.
 */
export async function resolveSignedDriverDocumentFile(params: {
  documentType: DriverDocumentType;
  token: string;
}): Promise<{ absolutePath: string; mimeType: string; originalFilename: string }> {
  const claims = readDocumentReadToken(params.token);
  if (claims.documentType !== params.documentType) {
    throw new DriverDocumentStorageError(
      'INVALID_DOCUMENT_READ_AUTHORIZATION',
      'Invalid document read token',
      403
    );
  }
  return resolveDocumentFile({
    driverId: claims.driverId,
    documentType: params.documentType,
    token: params.token,
  });
}

export async function resolveDocumentFile(params: {
  driverId: string;
  documentType: DriverDocumentType;
  token?: string;
}): Promise<{ absolutePath: string; mimeType: string; originalFilename: string }> {
  const row = await findDriverDocument(params.driverId, params.documentType);
  if (!row) {
    throw new DriverDocumentError('NOT_FOUND', 'Document not found', 404);
  }

  if (params.token) {
    verifyDocumentReadToken(params.token, {
      documentId: row.id,
      driverId: row.driverId,
      documentType: row.documentType as DriverDocumentType,
      storageKey: row.storageKey,
    });
  }

  const object = await inspectPrivateDocument(row.storageKey);
  if (!object) {
    throw new DriverDocumentError('DOCUMENT_OBJECT_NOT_FOUND', 'Document file is not available', 404);
  }

  return {
    absolutePath: object.absolutePath,
    mimeType: row.mimeType,
    originalFilename: row.originalFilename,
  };
}

export async function listAdminDriverDocuments(driverId: string): Promise<DriverDocumentMapDto> {
  if (!(await driverExists(driverId))) {
    throw new DriverDocumentError('NOT_FOUND', 'Driver not found', 404);
  }
  return listDocumentsForDriver(driverId, 'admin');
}

export async function getAdminDriverDocument(
  driverId: string,
  documentType: DriverDocumentType
): Promise<DriverDocumentMetadataDto> {
  if (!(await driverExists(driverId))) {
    throw new DriverDocumentError('NOT_FOUND', 'Driver not found', 404);
  }
  return getDocumentMetadataForDriver(driverId, documentType, 'admin');
}

export { DRIVER_DOCUMENT_TYPES, DriverDocumentStorageError };
