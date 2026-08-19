import fs from 'fs';
import path from 'path';

function read(rel: string) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

describe('profile foundation does not regress existing flows', () => {
  it('driver logout still invalidates push targets and clears session', () => {
    const src = read('src/routes/auth.ts');
    expect(src).toContain("router.post(\n  '/logout'");
    expect(src).toContain('invalidateDriverPushTargets');
    expect(src).toContain('clearSessionInfo');
  });

  it('passenger logout still clears customer session', () => {
    const src = read('src/services/passengerAuth.service.ts');
    expect(src).toContain('export async function logoutPassenger');
    expect(src).toContain('clearCustomerSession');
    expect(src).toContain('deleteByToken');
  });

  it('does not reuse ride-video private storage for avatars', () => {
    const src = read('src/services/avatar-storage.service.ts');
    expect(src).toContain("uploads");
    expect(src).toContain('avatars');
    expect(src).not.toContain('private-media');
    expect(src).not.toContain('ride-recordings');
  });

  it('registers profile routes under v1', () => {
    const src = read('src/routes/v1/index.ts');
    expect(src).toContain("router.use('/driver/profile'");
    expect(src).toContain("router.use('/passenger/profile'");
    expect(src).toContain("router.use('/admin/passengers'");
  });
});
