import { count, desc, eq } from 'drizzle-orm';
import { db } from '../db/connection';
import {
  PLATFORM_SETTINGS_ROW_ID,
  platformSettings,
  rideVideoAuditEvents,
  type PlatformSettings,
} from '../db/schema';

export const RECORDING_POLICY_AUDIT_ACTION = 'RECORDING_POLICY_UPDATED';

export async function findPlatformSettings(): Promise<PlatformSettings | null> {
  const rows = await db
    .select()
    .from(platformSettings)
    .where(eq(platformSettings.id, PLATFORM_SETTINGS_ROW_ID))
    .limit(1);
  return rows[0] ?? null;
}

export interface RecordingPolicyActor {
  adminUserId: string | null;
  auth0Id: string | null;
  email: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}

export type SetVideoRecordingResult =
  | { outcome: 'updated'; previous: PlatformSettings; row: PlatformSettings }
  | { outcome: 'unchanged'; row: PlatformSettings }
  | { outcome: 'version_conflict'; row: PlatformSettings };

/**
 * Serialised by a row lock so concurrent Admin writes apply one at a time,
 * each bumping version exactly once; the audit row commits atomically with it.
 */
export async function setVideoRecordingEnabledWithAudit(input: {
  enabled: boolean;
  expectedVersion?: number;
  actor: RecordingPolicyActor;
}): Promise<SetVideoRecordingResult> {
  return db.transaction(async (tx) => {
    await tx
      .insert(platformSettings)
      .values({ id: PLATFORM_SETTINGS_ROW_ID, videoRecordingEnabled: false, version: 1 })
      .onConflictDoNothing({ target: platformSettings.id });

    const [current] = await tx
      .select()
      .from(platformSettings)
      .where(eq(platformSettings.id, PLATFORM_SETTINGS_ROW_ID))
      .for('update');
    if (!current) {
      throw new Error('platform_settings row missing after initialisation');
    }

    if (input.expectedVersion !== undefined && input.expectedVersion !== current.version) {
      return { outcome: 'version_conflict', row: current };
    }
    if (current.videoRecordingEnabled === input.enabled) {
      return { outcome: 'unchanged', row: current };
    }

    const now = new Date();
    const [row] = await tx
      .update(platformSettings)
      .set({
        videoRecordingEnabled: input.enabled,
        version: current.version + 1,
        updatedByAdminUserId: input.actor.adminUserId,
        updatedByAuth0Id: input.actor.auth0Id,
        updatedByEmail: input.actor.email,
        updatedAt: now,
      })
      .where(eq(platformSettings.id, PLATFORM_SETTINGS_ROW_ID))
      .returning();

    await tx.insert(rideVideoAuditEvents).values({
      adminUserId: input.actor.adminUserId,
      adminAuth0Id: input.actor.auth0Id,
      adminEmail: input.actor.email,
      action: RECORDING_POLICY_AUDIT_ACTION,
      result: 'success',
      ipAddress: input.actor.ipAddress,
      userAgent: input.actor.userAgent,
      metadata: {
        setting: 'video_recording_enabled',
        previousValue: current.videoRecordingEnabled,
        newValue: input.enabled,
        previousVersion: current.version,
        newVersion: row.version,
        changedAt: now.toISOString(),
      },
    });

    return { outcome: 'updated', previous: current, row };
  });
}

export async function listRecordingPolicyAuditEvents(params: { page: number; limit: number }) {
  const offset = (params.page - 1) * params.limit;
  const where = eq(rideVideoAuditEvents.action, RECORDING_POLICY_AUDIT_ACTION);
  const [items, totalRow] = await Promise.all([
    db
      .select()
      .from(rideVideoAuditEvents)
      .where(where)
      .orderBy(desc(rideVideoAuditEvents.createdAt))
      .limit(params.limit)
      .offset(offset),
    db.select({ value: count() }).from(rideVideoAuditEvents).where(where),
  ]);
  return { items, total: Number(totalRow[0]?.value ?? 0) };
}
