import path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import { randomUUID } from 'crypto';
import sharp from 'sharp';

export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
export const AVATAR_MAX_DIMENSION = 1280;
export const AVATAR_ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

export type AvatarRole = 'drivers' | 'passengers';
export type DetectedImageKind = 'jpeg' | 'png' | 'webp';

export class AvatarStorageError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400
  ) {
    super(message);
    this.name = 'AvatarStorageError';
  }
}

const DEFAULT_UPLOADS_ROOT = path.resolve(process.cwd(), 'uploads');

function uploadsRoot(): string {
  return path.resolve(process.env.AVATAR_STORAGE_ROOT || DEFAULT_UPLOADS_ROOT);
}

function avatarsRoot(): string {
  return path.join(uploadsRoot(), 'avatars');
}

export function detectImageKind(buffer: Buffer): DetectedImageKind | null {
  if (buffer.length < 12) return null;
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
  const riff = buffer.toString('ascii', 0, 4);
  const webp = buffer.toString('ascii', 8, 12);
  if (riff === 'RIFF' && webp === 'WEBP') return 'webp';
  return null;
}

export function assertAvatarBuffer(buffer: Buffer, declaredMime?: string): DetectedImageKind {
  if (!buffer?.length) {
    throw new AvatarStorageError('VALIDATION_ERROR', 'Avatar file is required');
  }
  if (buffer.length > AVATAR_MAX_BYTES) {
    throw new AvatarStorageError('VALIDATION_ERROR', 'Avatar file exceeds 5MB limit');
  }
  if (declaredMime && !AVATAR_ALLOWED_MIME.has(declaredMime)) {
    throw new AvatarStorageError('VALIDATION_ERROR', 'Only JPEG, PNG, and WebP avatars are allowed');
  }
  const kind = detectImageKind(buffer);
  if (!kind) {
    throw new AvatarStorageError(
      'VALIDATION_ERROR',
      'File is not a valid JPEG, PNG, or WebP image'
    );
  }
  return kind;
}

export function publicApiBaseUrl(): string {
  const raw = (
    process.env.API_PUBLIC_BASE_URL ||
    process.env.VIDEO_API_PUBLIC_BASE_URL ||
    ''
  ).trim();
  if (!raw || raw === 'undefined') return '';
  if (!/^https?:\/\//i.test(raw)) return '';
  return raw.replace(/\/$/, '');
}

export function toPublicAvatarUrl(role: AvatarRole, fileName: string): string {
  const relative = `/uploads/avatars/${role}/${fileName}`;
  const base = publicApiBaseUrl();
  return base ? `${base}${relative}` : relative;
}

/**
 * Passenger-facing avatar URL. Managed avatars are rewritten with the current
 * public API base. Other absolute URLs are returned as stored. Non-avatar
 * paths, storage keys, and document URLs are not exposed.
 */
export function resolvePublicProfileImageUrl(stored: string | null | undefined): string | null {
  if (!stored?.trim()) return null;
  const value = stored.trim();
  const managed = parseManagedAvatarUrl(value);
  if (managed) {
    return toPublicAvatarUrl(managed.role, managed.fileName);
  }
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('/uploads/avatars/')) {
    const base = publicApiBaseUrl();
    return base ? `${base}${value}` : value;
  }
  if (value.startsWith('uploads/avatars/')) {
    const relative = `/${value}`;
    const base = publicApiBaseUrl();
    return base ? `${base}${relative}` : relative;
  }
  return null;
}

const MANAGED_FILE =
  /\/uploads\/avatars\/(drivers|passengers)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg)$/i;

export function parseManagedAvatarUrl(
  value: string | null | undefined
): { role: AvatarRole; fileName: string } | null {
  if (!value) return null;
  let pathname = value.trim();
  try {
    if (pathname.startsWith('http://') || pathname.startsWith('https://')) {
      pathname = new URL(pathname).pathname;
    }
  } catch {
    return null;
  }
  const match = pathname.replace(/\/+$/, '').match(MANAGED_FILE);
  if (!match) return null;
  return { role: match[1] as AvatarRole, fileName: match[2] };
}

export async function ensureAvatarDirectories(): Promise<void> {
  await fs.mkdir(path.join(avatarsRoot(), 'drivers'), { recursive: true });
  await fs.mkdir(path.join(avatarsRoot(), 'passengers'), { recursive: true });
}

function resolveManagedFile(role: AvatarRole, fileName: string): string {
  const dir = path.resolve(path.join(avatarsRoot(), role));
  const absolute = path.resolve(dir, fileName);
  if (!absolute.startsWith(dir + path.sep) && absolute !== dir) {
    throw new AvatarStorageError('VALIDATION_ERROR', 'Invalid avatar path');
  }
  return absolute;
}

export async function storeAvatar(params: {
  role: AvatarRole;
  buffer: Buffer;
  declaredMime?: string;
}): Promise<{ profileImageUrl: string; fileName: string }> {
  assertAvatarBuffer(params.buffer, params.declaredMime);
  await ensureAvatarDirectories();

  let processed: Buffer;
  try {
    processed = await sharp(params.buffer, { failOn: 'error' })
      .rotate()
      .resize({
        width: AVATAR_MAX_DIMENSION,
        height: AVATAR_MAX_DIMENSION,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer();
  } catch {
    throw new AvatarStorageError('VALIDATION_ERROR', 'Unable to process avatar image');
  }

  const fileName = `${randomUUID()}.jpg`;
  const absolute = resolveManagedFile(params.role, fileName);
  await fs.writeFile(absolute, processed);
  return { profileImageUrl: toPublicAvatarUrl(params.role, fileName), fileName };
}

export async function deleteManagedAvatar(
  currentUrl: string | null | undefined,
  expectedRole: AvatarRole
): Promise<boolean> {
  const parsed = parseManagedAvatarUrl(currentUrl);
  if (!parsed) return false;
  if (parsed.role !== expectedRole) return false;
  const absolute = resolveManagedFile(parsed.role, parsed.fileName);
  if (!existsSync(absolute)) return false;
  await fs.unlink(absolute);
  return true;
}
