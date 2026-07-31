import path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import { randomUUID } from 'crypto';

export interface VideoUploadInput {
  tempFilePath: string;
  originalName: string;
  mimeType: string;
}

export interface VideoUploadResult {
  fileName: string;
  storageKey: string;
  videoUrl: string;
  absolutePath: string;
}

export interface VideoStorageProvider {
  uploadVideo(input: VideoUploadInput): Promise<VideoUploadResult>;
  saveBuffer(input: {
    buffer: Buffer;
    mimeType: string;
    prefix?: string;
  }): Promise<VideoUploadResult>;
  deleteVideo(storageKey: string): Promise<void>;
  getVideoUrl(storageKey: string): string;
}

const UPLOADS_ROOT = path.resolve(process.cwd(), 'uploads');
const VIDEOS_ROOT = path.join(UPLOADS_ROOT, 'videos');

const ALLOWED_EXTENSIONS = new Set(['.mp4', '.mov']);

export function sanitizeOriginalName(name: string): string {
  const base = path.basename(name).replace(/[^\w.\-() ]+/g, '_');
  return base.slice(0, 255) || 'video';
}

function resolveExtension(originalName: string, mimeType: string): string {
  const ext = path.extname(originalName).toLowerCase();
  if (ALLOWED_EXTENSIONS.has(ext)) return ext;
  if (mimeType === 'video/quicktime') return '.mov';
  return '.mp4';
}

function buildStoragePaths(now: Date = new Date()) {
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dir = path.join(VIDEOS_ROOT, year, month);
  return { year, month, dir };
}

export class LocalVideoStorageService implements VideoStorageProvider {
  private publicBaseUrl: string;

  constructor(publicBaseUrl?: string) {
    this.publicBaseUrl = (publicBaseUrl ?? process.env.VIDEO_PUBLIC_BASE_URL ?? '/uploads').replace(
      /\/$/,
      ''
    );
  }

  async uploadVideo(input: VideoUploadInput): Promise<VideoUploadResult> {
    const { year, month, dir } = buildStoragePaths();
    console.log('[VideoStorage] uploadVideo:start', {
      year,
      month,
      dir,
      originalName: input.originalName,
      mimeType: input.mimeType,
      tempFilePath: input.tempFilePath,
    });

    await fs.mkdir(dir, { recursive: true });

    const ext = resolveExtension(input.originalName, input.mimeType);
    const fileName = `${randomUUID()}${ext}`;
    const absolutePath = path.join(dir, fileName);
    const storageKey = `videos/${year}/${month}/${fileName}`;

    console.log('[VideoStorage] uploadVideo:rename', { absolutePath, storageKey });
    await fs.rename(input.tempFilePath, absolutePath);

    const result = {
      fileName,
      storageKey,
      videoUrl: this.getVideoUrl(storageKey),
      absolutePath,
    };
    console.log('[VideoStorage] uploadVideo:done', result);
    return result;
  }

  async saveBuffer(input: {
    buffer: Buffer;
    mimeType: string;
    prefix?: string;
  }): Promise<VideoUploadResult> {
    const { year, month, dir } = buildStoragePaths();
    const segmentDir = input.prefix ? path.join(dir, input.prefix) : dir;
    await fs.mkdir(segmentDir, { recursive: true });

    const ext = input.mimeType === 'video/quicktime' ? '.mov' : '.mp4';
    const fileName = `${randomUUID()}${ext}`;
    const absolutePath = path.join(segmentDir, fileName);
    const storageKey = input.prefix
      ? `videos/${year}/${month}/${input.prefix}/${fileName}`
      : `videos/${year}/${month}/${fileName}`;

    await fs.writeFile(absolutePath, input.buffer);

    return {
      fileName,
      storageKey,
      videoUrl: this.getVideoUrl(storageKey),
      absolutePath,
    };
  }

  async deleteVideo(storageKey: string): Promise<void> {
    const normalized = storageKey.replace(/^\/+/, '').replace(/^uploads\//, '');
    const absolutePath = path.join(UPLOADS_ROOT, normalized);
    const resolved = path.resolve(absolutePath);
    if (!resolved.startsWith(UPLOADS_ROOT)) {
      throw new Error('Invalid storage key');
    }
    if (existsSync(resolved)) {
      await fs.unlink(resolved);
    }
  }

  getVideoUrl(storageKey: string): string {
    const normalized = storageKey.replace(/^\/+/, '');
    return `${this.publicBaseUrl}/${normalized}`;
  }
}

let storageInstance: VideoStorageProvider | null = null;

export function getVideoStorageService(): VideoStorageProvider {
  if (!storageInstance) {
    storageInstance = new LocalVideoStorageService();
  }
  return storageInstance;
}

export const localVideoStorage = getVideoStorageService();

export async function ensureUploadDirectories(): Promise<void> {
  await fs.mkdir(VIDEOS_ROOT, { recursive: true });
}

export { UPLOADS_ROOT, VIDEOS_ROOT };
