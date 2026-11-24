/**
 * platform_settings.video_recording_enabled against a real, migrated PostgreSQL.
 * Runs only when DATABASE_URL is set in the process environment (CI service
 * container or a disposable local container); never against ryd_u.
 * Restores the original row and removes its own audit rows afterwards.
 */
import fs from 'fs';
import path from 'path';
import postgres from 'postgres';

const TARGET_URL = process.env.DATABASE_URL;
const targetDbName = TARGET_URL ? new URL(TARGET_URL).pathname.replace(/^\//, '') : '';
const runDbTests = Boolean(TARGET_URL) && targetDbName !== 'ryd_u';

jest.mock('../src/services/bookingNotify.service', () => ({
  emitToAllDrivers: jest.fn().mockResolvedValue(undefined),
  emitToAdmins: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../src/middleware/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

type PolicyService = typeof import('../src/services/videoRecordingPolicy.service');

(runDbTests ? describe : describe.skip)('platform_settings video recording (live PostgreSQL)', () => {
  let sql: ReturnType<typeof postgres>;
  let service: PolicyService;
  let closeConnection: () => Promise<void>;
  let original: { video_recording_enabled: boolean; version: number; updated_at: Date } | undefined;
  const startedAt = new Date();

  beforeAll(async () => {
    sql = postgres(TARGET_URL!, { max: 1 });
    [original] = await sql`
      SELECT video_recording_enabled, version, updated_at FROM platform_settings WHERE id = 1`;
    service = await import('../src/services/videoRecordingPolicy.service');
    ({ closeConnection } = await import('../src/db/connection'));
  });

  afterAll(async () => {
    if (original) {
      await sql`
        UPDATE platform_settings
        SET video_recording_enabled = ${original.video_recording_enabled},
            version = ${original.version},
            updated_at = ${original.updated_at},
            updated_by_admin_user_id = NULL,
            updated_by_auth0_id = NULL,
            updated_by_email = NULL
        WHERE id = 1`;
    }
    await sql`
      DELETE FROM ride_video_audit_events
      WHERE action = 'RECORDING_POLICY_UPDATED'
        AND admin_auth0_id = 'auth0|policy-db-test'
        AND created_at >= ${startedAt}`;
    await sql.end({ timeout: 5 });
    await closeConnection();
  });

  it('migration seeds exactly one row, OFF, with a singleton constraint', async () => {
    expect(original).toBeDefined();
    expect(original!.video_recording_enabled).toBe(false);
    const [{ rows }] = await sql`SELECT count(*)::int AS rows FROM platform_settings`;
    expect(rows).toBe(1);
    await expect(
      sql`INSERT INTO platform_settings (id, video_recording_enabled) VALUES (2, true)`
    ).rejects.toMatchObject({ code: '23514' });
    const [column] = await sql`
      SELECT column_default, is_nullable FROM information_schema.columns
      WHERE table_name = 'platform_settings' AND column_name = 'video_recording_enabled'`;
    expect(column).toMatchObject({ column_default: 'false', is_nullable: 'NO' });
  });

  it('reads default OFF through the service', async () => {
    await expect(service.getDriverVideoRecordingConfig()).resolves.toMatchObject({
      enabled: false,
      version: original!.version,
    });
  });

  it('persists an Admin change with an audit row and survives a fresh connection', async () => {
    const result = await service.updateVideoRecordingConfig({
      enabled: true,
      expectedVersion: original!.version,
      actor: { auth0Id: 'auth0|policy-db-test', email: 'policy-db-test@example.com' },
    });
    expect(result).toMatchObject({ enabled: true, version: original!.version + 1, changed: true });

    const fresh = postgres(TARGET_URL!, { max: 1 });
    try {
      const [row] = await fresh`
        SELECT video_recording_enabled, version, updated_by_email FROM platform_settings WHERE id = 1`;
      expect(row).toEqual({
        video_recording_enabled: true,
        version: original!.version + 1,
        updated_by_email: 'policy-db-test@example.com',
      });
      const audit = await fresh`
        SELECT admin_email, metadata FROM ride_video_audit_events
        WHERE action = 'RECORDING_POLICY_UPDATED' AND admin_auth0_id = 'auth0|policy-db-test'
        ORDER BY created_at DESC LIMIT 1`;
      expect(audit[0].admin_email).toBe('policy-db-test@example.com');
      expect(audit[0].metadata).toMatchObject({
        setting: 'video_recording_enabled',
        previousValue: false,
        newValue: true,
        newVersion: original!.version + 1,
      });
    } finally {
      await fresh.end({ timeout: 5 });
    }
  });

  it('re-running the migration does not overwrite the Admin choice', async () => {
    const migration = fs.readFileSync(
      path.join(__dirname, '../src/db/migrations/0041_platform_settings_video_recording.sql'),
      'utf8'
    );
    await sql.unsafe(migration);
    const [row] = await sql`SELECT video_recording_enabled FROM platform_settings WHERE id = 1`;
    expect(row.video_recording_enabled).toBe(true);
  });

  it('serialises concurrent writers: one wins, the stale one gets 409', async () => {
    const current = await service.getAdminVideoRecordingConfig();
    const attempts = await Promise.allSettled([
      service.updateVideoRecordingConfig({
        enabled: false,
        expectedVersion: current.version,
        actor: { auth0Id: 'auth0|policy-db-test' },
      }),
      service.updateVideoRecordingConfig({
        enabled: false,
        expectedVersion: current.version,
        actor: { auth0Id: 'auth0|policy-db-test' },
      }),
    ]);
    const fulfilled = attempts.filter((a) => a.status === 'fulfilled');
    const rejected = attempts.filter((a) => a.status === 'rejected') as PromiseRejectedResult[];
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({
      code: 'VIDEO_RECORDING_POLICY_VERSION_CONFLICT',
      statusCode: 409,
    });
    const [row] = await sql`SELECT video_recording_enabled, version FROM platform_settings WHERE id = 1`;
    expect(row).toEqual({ video_recording_enabled: false, version: current.version + 1 });
  });

  it('treats a missing row as OFF', async () => {
    const [saved] = await sql`SELECT * FROM platform_settings WHERE id = 1`;
    await sql`DELETE FROM platform_settings WHERE id = 1`;
    try {
      await expect(service.getDriverVideoRecordingConfig()).resolves.toEqual({
        enabled: false,
        version: 0,
        updatedAt: null,
      });
    } finally {
      await sql`
        INSERT INTO platform_settings (id, video_recording_enabled, version, created_at, updated_at)
        VALUES (1, ${saved.video_recording_enabled}, ${saved.version}, ${saved.created_at}, ${saved.updated_at})`;
    }
  });
});
