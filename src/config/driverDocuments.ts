import path from 'path';
import { getEnvVarAsNumber } from './env-validator';

const maxBytes = getEnvVarAsNumber('DRIVER_DOCUMENT_MAX_BYTES', 10 * 1024 * 1024);
const readUrlTtlSeconds = getEnvVarAsNumber('DRIVER_DOCUMENT_READ_URL_TTL_SECONDS', 300);

for (const [name, value] of Object.entries({
  DRIVER_DOCUMENT_MAX_BYTES: maxBytes,
  DRIVER_DOCUMENT_READ_URL_TTL_SECONDS: readUrlTtlSeconds,
})) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
}

export const DRIVER_DOCUMENT_TYPES = ['driving_license', 'insurance'] as const;
export type DriverDocumentType = (typeof DRIVER_DOCUMENT_TYPES)[number];

export const DRIVER_DOCUMENT_ALLOWED_MIME = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
} as const;

export type DriverDocumentMime = keyof typeof DRIVER_DOCUMENT_ALLOWED_MIME;

export function driverDocumentStorageContainer(): string {
  return process.env.DRIVER_DOCUMENT_STORAGE_CONTAINER || 'driver-documents';
}

export function driverDocumentStorageRoot(): string {
  return path.resolve(
    process.env.DRIVER_DOCUMENT_STORAGE_ROOT ||
      process.env.VIDEO_STORAGE_ROOT ||
      'private-media'
  );
}

export function driverDocumentApiPublicBaseUrl(): string {
  return (
    process.env.API_PUBLIC_BASE_URL ||
    process.env.VIDEO_API_PUBLIC_BASE_URL ||
    ''
  )
    .trim()
    .replace(/\/$/, '');
}

export const driverDocumentConfig = {
  maxBytes,
  readUrlTtlSeconds,
  get storageContainer() {
    return driverDocumentStorageContainer();
  },
  get storageRoot() {
    return driverDocumentStorageRoot();
  },
  get apiPublicBaseUrl() {
    return driverDocumentApiPublicBaseUrl();
  },
};

export function isDriverDocumentType(value: string): value is DriverDocumentType {
  return (DRIVER_DOCUMENT_TYPES as readonly string[]).includes(value);
}
