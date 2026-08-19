import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import {
  AVATAR_MAX_BYTES,
  assertAvatarBuffer,
  deleteManagedAvatar,
  detectImageKind,
  parseManagedAvatarUrl,
  storeAvatar,
  toPublicAvatarUrl,
} from '../src/services/avatar-storage.service';

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

describe('avatar detection', () => {
  it('detects jpeg/png/webp magic bytes', async () => {
    const jpeg = await sharp(PNG_1x1).jpeg().toBuffer();
    const webp = await sharp(PNG_1x1).webp().toBuffer();
    expect(detectImageKind(PNG_1x1)).toBe('png');
    expect(detectImageKind(jpeg)).toBe('jpeg');
    expect(detectImageKind(webp)).toBe('webp');
  });

  it('rejects mp4 ftyp buffer', () => {
    const mp4 = Buffer.alloc(32, 0);
    mp4.write('ftyp', 4, 'ascii');
    expect(detectImageKind(mp4)).toBeNull();
    expect(() => assertAvatarBuffer(mp4, 'image/jpeg')).toThrow(/not a valid/);
  });

  it('rejects fake jpeg MIME with non-image bytes', () => {
    const fake = Buffer.from('not-an-image-file-at-all');
    expect(() => assertAvatarBuffer(fake, 'image/jpeg')).toThrow(/not a valid/);
  });

  it('rejects oversized buffers', () => {
    const huge = Buffer.alloc(AVATAR_MAX_BYTES + 1);
    expect(() => assertAvatarBuffer(huge, 'image/jpeg')).toThrow(/5MB/);
  });
});

describe('managed avatar URLs', () => {
  it('parses only managed avatar paths', () => {
    const fileName = '11111111-1111-1111-1111-111111111111.jpg';
    expect(parseManagedAvatarUrl(`/uploads/avatars/drivers/${fileName}`)).toEqual({
      role: 'drivers',
      fileName,
    });
    expect(parseManagedAvatarUrl('https://api.example.com/uploads/avatars/passengers/' + fileName)).toEqual({
      role: 'passengers',
      fileName,
    });
    expect(parseManagedAvatarUrl('/uploads/videos/secret.mp4')).toBeNull();
    expect(parseManagedAvatarUrl('/etc/passwd')).toBeNull();
    expect(parseManagedAvatarUrl('https://evil.test/uploads/avatars/drivers/nope.jpg')).toBeNull();
  });

  it('builds public URL from API base when configured', () => {
    const prev = process.env.API_PUBLIC_BASE_URL;
    process.env.API_PUBLIC_BASE_URL = 'https://api.rydu.test';
    expect(toPublicAvatarUrl('drivers', 'x.jpg')).toBe(
      'https://api.rydu.test/uploads/avatars/drivers/x.jpg'
    );
    if (prev === undefined) {
      delete process.env.API_PUBLIC_BASE_URL;
    } else {
      process.env.API_PUBLIC_BASE_URL = prev;
    }
  });
});

describe('avatar store and replace', () => {
  const tmp = path.join(os.tmpdir(), `rydu-avatar-test-${Date.now()}`);

  beforeAll(() => {
    process.env.AVATAR_STORAGE_ROOT = tmp;
  });

  afterAll(async () => {
    delete process.env.AVATAR_STORAGE_ROOT;
    await fs.promises.rm(tmp, { recursive: true, force: true });
  });

  it('accepts jpeg png webp and stores jpeg', async () => {
    const jpeg = await sharp(PNG_1x1).jpeg().toBuffer();
    const webp = await sharp(PNG_1x1).webp().toBuffer();
    const a = await storeAvatar({ role: 'drivers', buffer: jpeg, declaredMime: 'image/jpeg' });
    const b = await storeAvatar({ role: 'drivers', buffer: PNG_1x1, declaredMime: 'image/png' });
    const c = await storeAvatar({ role: 'passengers', buffer: webp, declaredMime: 'image/webp' });
    expect(a.profileImageUrl).toMatch(/\/uploads\/avatars\/drivers\/.+\.jpg$/);
    expect(b.profileImageUrl).toMatch(/\/uploads\/avatars\/drivers\/.+\.jpg$/);
    expect(c.profileImageUrl).toMatch(/\/uploads\/avatars\/passengers\/.+\.jpg$/);
  });

  it('deletes previous managed avatar and ignores arbitrary URLs', async () => {
    const stored = await storeAvatar({
      role: 'drivers',
      buffer: PNG_1x1,
      declaredMime: 'image/png',
    });
    const parsed = parseManagedAvatarUrl(stored.profileImageUrl);
    expect(parsed).toBeTruthy();
    const abs = path.join(tmp, 'avatars', 'drivers', parsed!.fileName);
    expect(fs.existsSync(abs)).toBe(true);
    await expect(deleteManagedAvatar(stored.profileImageUrl, 'drivers')).resolves.toBe(true);
    expect(fs.existsSync(abs)).toBe(false);
    await expect(deleteManagedAvatar('https://cdn.example/hack.jpg', 'drivers')).resolves.toBe(false);
  });
});
