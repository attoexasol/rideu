import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import {
  DRIVER_DOCUMENT_ALLOWED_MIME,
  driverDocumentConfig,
  type DriverDocumentMime,
  type DriverDocumentType,
} from '../config/driverDocuments';

export type DetectedDocumentKind = 'pdf' | 'jpeg' | 'png';

interface DocumentReadTokenPayload {
  purpose: 'driver_document_read';
  documentId: string;
  driverId: string;
  documentType: DriverDocumentType;
  storageKey: string;
  exp: number;
}

const developmentSigningSecret = randomBytes(32).toString('hex');
let warnedUnstableSigningSecret = false;

export class DriverDocumentStorageError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400
  ) {
    super(message);
    this.name = 'DriverDocumentStorageError';
  }
}

function signingSecret(): string {
  const configured =
    process.env.DRIVER_DOCUMENT_SIGNING_SECRET ||
    process.env.VIDEO_SIGNING_SECRET ||
    process.env.JWT_SECRET;
  if (configured) return configured;
  if (!warnedUnstableSigningSecret) {
    warnedUnstableSigningSecret = true;
    console.warn(
      '[driver-documents] DRIVER_DOCUMENT_SIGNING_SECRET/VIDEO_SIGNING_SECRET/JWT_SECRET unset — using ephemeral dev secret; read tokens invalidate on server restart'
    );
  }
  return developmentSigningSecret;
}

function signature(encodedPayload: string): string {
  return createHmac('sha256', signingSecret()).update(encodedPayload).digest('base64url');
}

function signToken(payload: DocumentReadTokenPayload): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encodedPayload}.${signature(encodedPayload)}`;
}

export function detectDocumentKind(buffer: Buffer): DetectedDocumentKind | null {
  if (!buffer || buffer.length < 8) return null;
  if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
    return 'pdf';
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'png';
  }
  return null;
}

const KIND_TO_MIME: Record<DetectedDocumentKind, DriverDocumentMime> = {
  pdf: 'application/pdf',
  jpeg: 'image/jpeg',
  png: 'image/png',
};

export function assertDocumentBuffer(
  buffer: Buffer,
  declaredMime?: string
): { kind: DetectedDocumentKind; mimeType: DriverDocumentMime; extension: string } {
  if (!buffer?.length) {
    throw new DriverDocumentStorageError('VALIDATION_ERROR', 'Document file is required');
  }
  if (buffer.length > driverDocumentConfig.maxBytes) {
    throw new DriverDocumentStorageError(
      'FILE_TOO_LARGE',
      `Document exceeds ${Math.floor(driverDocumentConfig.maxBytes / (1024 * 1024))} MB limit`,
      413
    );
  }
  if (declaredMime && !(declaredMime in DRIVER_DOCUMENT_ALLOWED_MIME)) {
    throw new DriverDocumentStorageError(
      'INVALID_DOCUMENT_TYPE',
      'Only PDF, JPEG, and PNG documents are allowed'
    );
  }
  const kind = detectDocumentKind(buffer);
  if (!kind) {
    throw new DriverDocumentStorageError(
      'INVALID_DOCUMENT_TYPE',
      'File is not a valid PDF, JPEG, or PNG document'
    );
  }
  const mimeType = KIND_TO_MIME[kind];
  if (declaredMime && declaredMime !== mimeType) {
    throw new DriverDocumentStorageError(
      'INVALID_DOCUMENT_TYPE',
      'Declared file type does not match the file contents'
    );
  }
  return {
    kind,
    mimeType,
    extension: DRIVER_DOCUMENT_ALLOWED_MIME[mimeType],
  };
}

export function sanitizeOriginalFilename(raw: string | undefined, extension: string): string {
  const fallback = `document.${extension}`;
  const base = path.basename(String(raw || '')).replace(/[\u0000-\u001f\u007f]/g, '');
  let cleaned = base.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^\.+/, '');
  if (cleaned.includes('..') || cleaned.includes('/') || cleaned.includes('\\')) {
    return fallback;
  }
  cleaned = cleaned.slice(0, 200);
  if (!cleaned || cleaned === '_') return fallback;
  const lower = cleaned.toLowerCase();
  if (!lower.endsWith(`.${extension}`)) {
    cleaned = `${cleaned.replace(/\.[a-zA-Z0-9]+$/, '')}.${extension}`;
  } else {
    cleaned = `${cleaned.slice(0, cleaned.length - extension.length - 1)}.${extension}`;
  }
  return cleaned.slice(0, 255);
}

export function createDocumentStorageKey(params: {
  driverId: string;
  documentType: DriverDocumentType;
  extension: string;
}): string {
  if (!/^[0-9a-f-]{36}$/i.test(params.driverId)) {
    throw new DriverDocumentStorageError('VALIDATION_ERROR', 'Invalid driver ID');
  }
  return `${driverDocumentConfig.storageContainer}/${params.driverId}/${params.documentType}/${randomUUID()}.${params.extension}`;
}

function resolveStoragePath(storageKey: string): string {
  const normalized = storageKey.replace(/\\/g, '/').replace(/^\/+/, '');
  if (
    normalized.includes('..') ||
    !normalized.startsWith(`${driverDocumentConfig.storageContainer}/`)
  ) {
    throw new DriverDocumentStorageError('FORBIDDEN', 'Invalid document storage key', 403);
  }
  const root = `${path.resolve(driverDocumentConfig.storageRoot)}${path.sep}`;
  const resolved = path.resolve(driverDocumentConfig.storageRoot, normalized);
  if (!resolved.startsWith(root)) {
    throw new DriverDocumentStorageError('FORBIDDEN', 'Invalid document storage key', 403);
  }
  return resolved;
}

export async function ensureDriverDocumentDirectories(): Promise<void> {
  await fs.mkdir(
    path.join(driverDocumentConfig.storageRoot, driverDocumentConfig.storageContainer),
    { recursive: true }
  );
}

export async function savePrivateDocument(
  storageKey: string,
  buffer: Buffer
): Promise<{ fileSizeBytes: number }> {
  const absolutePath = resolveStoragePath(storageKey);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, buffer, { flag: 'wx' });
  return { fileSizeBytes: buffer.length };
}

export async function inspectPrivateDocument(
  storageKey: string
): Promise<{ fileSizeBytes: number; absolutePath: string } | null> {
  const absolutePath = resolveStoragePath(storageKey);
  try {
    const stat = await fs.stat(absolutePath);
    if (!stat.isFile()) return null;
    return { fileSizeBytes: stat.size, absolutePath };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function deletePrivateDocument(storageKey: string): Promise<void> {
  if (!storageKey) return;
  const absolutePath = resolveStoragePath(storageKey);
  if (!existsSync(absolutePath)) return;
  await fs.unlink(absolutePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  });
}

export function createDocumentReadToken(params: {
  documentId: string;
  driverId: string;
  documentType: DriverDocumentType;
  storageKey: string;
}): { token: string; expiresAt: Date } {
  const expiresAt = new Date(Date.now() + driverDocumentConfig.readUrlTtlSeconds * 1000);
  return {
    token: signToken({
      purpose: 'driver_document_read',
      ...params,
      exp: Math.floor(expiresAt.getTime() / 1000),
    }),
    expiresAt,
  };
}

function invalidReadToken(message = 'Invalid document read token'): DriverDocumentStorageError {
  return new DriverDocumentStorageError('INVALID_DOCUMENT_READ_AUTHORIZATION', message, 403);
}

/** Signature, purpose, and expiry only. Caller must still bind the claims to the stored row. */
export function readDocumentReadToken(token: string): DocumentReadTokenPayload {
  const [encodedPayload, providedSignature] = token.split('.');
  if (!encodedPayload || !providedSignature) {
    throw invalidReadToken();
  }

  const expectedSignature = signature(encodedPayload);
  const providedBuffer = Buffer.from(providedSignature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (
    providedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    throw invalidReadToken();
  }

  let payload: DocumentReadTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  } catch {
    throw invalidReadToken();
  }

  const validAt = Math.floor(Date.now() / 1000);
  if (payload.purpose !== 'driver_document_read') {
    throw invalidReadToken();
  }
  if (!Number.isFinite(payload.exp) || payload.exp <= validAt) {
    throw invalidReadToken('Document read token has expired');
  }
  return payload;
}

export function verifyDocumentReadToken(
  token: string,
  expected: {
    documentId: string;
    driverId: string;
    documentType: DriverDocumentType;
    storageKey: string;
  }
): DocumentReadTokenPayload {
  const payload = readDocumentReadToken(token);
  if (payload.documentId !== expected.documentId) {
    throw invalidReadToken();
  }
  if (payload.driverId !== expected.driverId) {
    throw invalidReadToken();
  }
  if (payload.documentType !== expected.documentType) {
    throw invalidReadToken();
  }
  if (payload.storageKey !== expected.storageKey) {
    throw invalidReadToken();
  }
  return payload;
}

export function toSignedDocumentUrl(relativePath: string): string {
  const base = driverDocumentConfig.apiPublicBaseUrl;
  return base ? `${base}${relativePath}` : relativePath;
}
