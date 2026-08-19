import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { videoConfig } from '../config/video';

type TokenPurpose = 'upload' | 'read';

interface StorageTokenPayload {
  purpose: TokenPurpose;
  segmentId: string;
  storageKey: string;
  driverId?: string;
  exp: number;
}

const developmentSigningSecret = randomBytes(32).toString('hex');
let warnedUnstableVideoSigningSecret = false;

function signingSecret(): string {
  const configured = process.env.VIDEO_SIGNING_SECRET || process.env.JWT_SECRET;
  if (configured) return configured;
  if (!warnedUnstableVideoSigningSecret) {
    warnedUnstableVideoSigningSecret = true;
    console.warn(
      '[ride-video] VIDEO_SIGNING_SECRET/JWT_SECRET unset — using ephemeral dev secret; upload tokens invalidate on server restart'
    );
  }
  return developmentSigningSecret;
}

export type StorageTokenFailureReason =
  | 'malformed'
  | 'bad_signature'
  | 'purpose_mismatch'
  | 'segment_mismatch'
  | 'storage_key_mismatch'
  | 'driver_mismatch'
  | 'expired';

function signature(encodedPayload: string): string {
  return createHmac('sha256', signingSecret()).update(encodedPayload).digest('base64url');
}

function signToken(payload: StorageTokenPayload): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encodedPayload}.${signature(encodedPayload)}`;
}

export function verifyStorageToken(
  token: string,
  expected: Pick<StorageTokenPayload, 'purpose' | 'segmentId' | 'storageKey'> & {
    driverId?: string;
    /** Unix seconds — token must not expire before this instant (defaults to now). */
    validAt?: number;
  }
): StorageTokenPayload {
  const validAt = expected.validAt ?? Math.floor(Date.now() / 1000);
  const [encodedPayload, providedSignature] = token.split('.');
  if (!encodedPayload || !providedSignature) {
    throw new StorageTokenError('malformed', 'Invalid video storage token');
  }

  const expectedSignature = signature(encodedPayload);
  const providedBuffer = Buffer.from(providedSignature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (
    providedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    throw new StorageTokenError('bad_signature', 'Invalid video storage token');
  }

  let payload: StorageTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  } catch {
    throw new StorageTokenError('malformed', 'Invalid video storage token');
  }

  if (payload.purpose !== expected.purpose) {
    throw new StorageTokenError('purpose_mismatch', 'Video storage token does not match this resource');
  }
  if (payload.segmentId !== expected.segmentId) {
    throw new StorageTokenError('segment_mismatch', 'Video storage token does not match this resource');
  }
  if (payload.storageKey !== expected.storageKey) {
    throw new StorageTokenError('storage_key_mismatch', 'Video storage token does not match this resource');
  }
  if (expected.driverId && payload.driverId !== expected.driverId) {
    throw new StorageTokenError('driver_mismatch', 'Video storage token does not match this resource');
  }
  if (!Number.isFinite(payload.exp) || payload.exp <= validAt) {
    throw new StorageTokenError('expired', 'Video storage token has expired');
  }
  return payload;
}

export class StorageTokenError extends Error {
  constructor(
    public readonly reason: StorageTokenFailureReason,
    message: string
  ) {
    super(message);
  }
}

export function createPrivateStorageKey(params: {
  bookingId: string;
  sessionId: string;
  sequenceNumber: number;
  segmentId: string;
  mimeType: string;
}): string {
  const extension = params.mimeType === 'video/quicktime' ? 'mov' : 'mp4';
  return `${videoConfig.storageContainer}/${params.bookingId}/${params.sessionId}/${params.sequenceNumber}-${params.segmentId}.${extension}`;
}

export function createUploadToken(params: {
  segmentId: string;
  driverId: string;
  storageKey: string;
}): { token: string; expiresAt: Date } {
  const expiresAt = new Date(Date.now() + videoConfig.uploadUrlTtlSeconds * 1000);
  return {
    token: signToken({
      purpose: 'upload',
      ...params,
      exp: Math.floor(expiresAt.getTime() / 1000),
    }),
    expiresAt,
  };
}

export function createReadToken(params: { segmentId: string; storageKey: string }): {
  token: string;
  expiresAt: Date;
} {
  const expiresAt = new Date(Date.now() + videoConfig.readUrlTtlSeconds * 1000);
  return {
    token: signToken({
      purpose: 'read',
      ...params,
      exp: Math.floor(expiresAt.getTime() / 1000),
    }),
    expiresAt,
  };
}

function resolveStoragePath(storageKey: string): string {
  const normalized = storageKey.replace(/\\/g, '/').replace(/^\/+/, '');
  const resolved = path.resolve(videoConfig.storageRoot, normalized);
  const root = `${path.resolve(videoConfig.storageRoot)}${path.sep}`;
  if (!resolved.startsWith(root)) throw new Error('Invalid video storage key');
  return resolved;
}

export async function savePrivateSegment(
  storageKey: string,
  buffer: Buffer
): Promise<{ fileSizeBytes: number; checksum: string }> {
  const absolutePath = resolveStoragePath(storageKey);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs
    .writeFile(absolutePath, buffer, { flag: 'wx' })
    .catch(async (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error;
      const existing = await fs.readFile(absolutePath);
      if (!existing.equals(buffer))
        throw new Error('A different object already exists for this segment');
    });
  return {
    fileSizeBytes: buffer.length,
    checksum: createHash('sha256').update(buffer).digest('hex'),
  };
}

export async function inspectPrivateSegment(
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

export async function deletePrivateSegment(storageKey: string): Promise<void> {
  const absolutePath = resolveStoragePath(storageKey);
  await fs.unlink(absolutePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  });
}
