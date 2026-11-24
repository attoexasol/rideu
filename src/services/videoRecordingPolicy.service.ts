/**
 * Global ride video recording policy (platform_settings.video_recording_enabled).
 *
 * PostgreSQL is authoritative. A missing row, a non-boolean value, or a failed
 * read all resolve to OFF. Recording is effective only when the deployment has
 * the recording pipeline available (VIDEO_RECORDING_ENABLED) AND the Admin
 * setting is ON.
 */

import { videoConfig } from '../config/video';
import { adminUtils } from '../db/utils';
import { logger } from '../middleware/logger';
import {
  findPlatformSettings,
  listRecordingPolicyAuditEvents,
  setVideoRecordingEnabledWithAudit,
} from '../repositories/platformSettings.repository';
import type { PlatformSettings } from '../db/schema';
import { emitToAdmins, emitToAllDrivers } from './bookingNotify.service';
import { RideVideoError } from './rideVideo.errors';

export const VIDEO_RECORDING_CONFIG_UPDATED_EVENT = 'video_recording_config_updated';

export interface VideoRecordingSetting {
  /** Persisted Admin setting. */
  enabled: boolean;
  version: number;
  updatedAt: Date | null;
  updatedByEmail: string | null;
}

export interface AdminVideoRecordingView {
  enabled: boolean;
  effectiveEnabled: boolean;
  serverRecordingAvailable: boolean;
  version: number;
  updatedAt: string | null;
  updatedBy: { email: string | null } | null;
}

export interface DriverVideoRecordingView {
  enabled: boolean;
  version: number;
  updatedAt: string | null;
}

export type VideoRecordingConfigReason = 'admin_update' | 'connection_sync';

export class VideoRecordingPolicyError extends RideVideoError {}

export function videoRecordingPolicyUnavailable(): VideoRecordingPolicyError {
  return new VideoRecordingPolicyError(
    'VIDEO_RECORDING_POLICY_UNAVAILABLE',
    'Video recording policy is temporarily unavailable; recording is not permitted',
    503
  );
}

export function videoRecordingDisabled(): RideVideoError {
  return new RideVideoError('VIDEO_RECORDING_DISABLED', 'Ride video recording is disabled', 503);
}

const MISSING_SETTING: VideoRecordingSetting = {
  enabled: false,
  version: 0,
  updatedAt: null,
  updatedByEmail: null,
};

function toSetting(row: PlatformSettings | null): VideoRecordingSetting {
  if (!row) return MISSING_SETTING;
  return {
    enabled: row.videoRecordingEnabled === true,
    version: Number.isSafeInteger(row.version) ? row.version : 0,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt : null,
    updatedByEmail: row.updatedByEmail ?? null,
  };
}

function logPolicyDbFailure(error: unknown, context: string): void {
  logger.error({
    event: 'video_recording_policy.db_failed',
    context,
    pgCode: (error as { code?: string; cause?: { code?: string } })?.cause?.code ??
      (error as { code?: string })?.code ??
      null,
    errorName: error instanceof Error ? error.name : 'unknown',
  });
}

/** Strict read: throws VIDEO_RECORDING_POLICY_UNAVAILABLE when PostgreSQL cannot be read. */
export async function getVideoRecordingSetting(): Promise<VideoRecordingSetting> {
  try {
    return toSetting(await findPlatformSettings());
  } catch (error) {
    logPolicyDbFailure(error, 'strict');
    throw videoRecordingPolicyUnavailable();
  }
}

/** Fail-closed read for gates that must not throw: any error means OFF. */
export async function isVideoRecordingSettingEnabled(context: string): Promise<boolean> {
  try {
    return toSetting(await findPlatformSettings()).enabled;
  } catch (error) {
    logPolicyDbFailure(error, context);
    return false;
  }
}

/** Pipeline available AND Admin setting ON; any read failure means OFF. */
export async function isVideoRecordingEffectivelyEnabled(context: string): Promise<boolean> {
  if (!videoConfig.enabled) return false;
  return isVideoRecordingSettingEnabled(context);
}

/** Throws unless new recording may start now. */
export async function assertVideoRecordingPolicyEnabled(): Promise<VideoRecordingSetting> {
  const setting = await getVideoRecordingSetting();
  if (!setting.enabled) throw videoRecordingDisabled();
  return setting;
}

export function toAdminVideoRecordingView(setting: VideoRecordingSetting): AdminVideoRecordingView {
  return {
    enabled: setting.enabled,
    effectiveEnabled: videoConfig.enabled && setting.enabled,
    serverRecordingAvailable: videoConfig.enabled,
    version: setting.version,
    updatedAt: setting.updatedAt?.toISOString() ?? null,
    updatedBy: setting.updatedByEmail ? { email: setting.updatedByEmail } : null,
  };
}

export function toDriverVideoRecordingView(
  setting: VideoRecordingSetting
): DriverVideoRecordingView {
  return {
    enabled: videoConfig.enabled && setting.enabled,
    version: setting.version,
    updatedAt: setting.updatedAt?.toISOString() ?? null,
  };
}

export async function getAdminVideoRecordingConfig(): Promise<AdminVideoRecordingView> {
  return toAdminVideoRecordingView(await getVideoRecordingSetting());
}

export async function getDriverVideoRecordingConfig(): Promise<DriverVideoRecordingView> {
  return toDriverVideoRecordingView(await getVideoRecordingSetting());
}

export interface VideoRecordingAdminActor {
  auth0Id?: string;
  email?: string;
  ipAddress?: string;
  userAgent?: string;
}

async function resolveAdminUserId(auth0Id?: string): Promise<string | null> {
  if (!auth0Id) return null;
  try {
    return (await adminUtils.findByAuth0Id(auth0Id))?.id ?? null;
  } catch {
    return null;
  }
}

export async function notifyVideoRecordingConfigUpdated(
  setting: VideoRecordingSetting,
  reason: VideoRecordingConfigReason
): Promise<void> {
  const results = await Promise.allSettled([
    emitToAllDrivers(VIDEO_RECORDING_CONFIG_UPDATED_EVENT, {
      ...toDriverVideoRecordingView(setting),
      reason,
    }),
    emitToAdmins(VIDEO_RECORDING_CONFIG_UPDATED_EVENT, {
      ...toAdminVideoRecordingView(setting),
      reason,
    }),
  ]);
  for (const result of results) {
    if (result.status === 'rejected') {
      logger.warn({
        event: 'video_recording_policy.notify_failed',
        version: setting.version,
        errorName: result.reason instanceof Error ? result.reason.name : 'unknown',
      });
    }
  }
}

/**
 * Sends the persisted policy to one authenticated driver socket (connect and
 * reconnect). If PostgreSQL cannot be read nothing is sent: REST then returns
 * 503 and the recording gates refuse new recording, so the client stays OFF.
 */
export async function syncVideoRecordingConfigToSocket(socket: {
  emit: (event: string, payload: unknown) => unknown;
}): Promise<boolean> {
  let setting: VideoRecordingSetting;
  try {
    setting = toSetting(await findPlatformSettings());
  } catch (error) {
    logPolicyDbFailure(error, 'connection_sync');
    return false;
  }
  socket.emit(VIDEO_RECORDING_CONFIG_UPDATED_EVENT, {
    ...toDriverVideoRecordingView(setting),
    reason: 'connection_sync' satisfies VideoRecordingConfigReason,
  });
  return true;
}

export async function updateVideoRecordingConfig(input: {
  enabled: boolean;
  expectedVersion?: number;
  actor: VideoRecordingAdminActor;
}): Promise<AdminVideoRecordingView & { changed: boolean }> {
  if (typeof input.enabled !== 'boolean') {
    throw new VideoRecordingPolicyError('VALIDATION_ERROR', 'enabled must be a boolean', 400);
  }

  const adminUserId = await resolveAdminUserId(input.actor.auth0Id);
  let result: Awaited<ReturnType<typeof setVideoRecordingEnabledWithAudit>>;
  try {
    result = await setVideoRecordingEnabledWithAudit({
      enabled: input.enabled,
      expectedVersion: input.expectedVersion,
      actor: {
        adminUserId,
        auth0Id: input.actor.auth0Id ?? null,
        email: input.actor.email ?? null,
        ipAddress: input.actor.ipAddress ?? null,
        userAgent: input.actor.userAgent ?? null,
      },
    });
  } catch (error) {
    logPolicyDbFailure(error, 'update');
    throw videoRecordingPolicyUnavailable();
  }

  if (result.outcome === 'version_conflict') {
    throw new VideoRecordingPolicyError(
      'VIDEO_RECORDING_POLICY_VERSION_CONFLICT',
      `Setting was changed by another administrator (current version ${result.row.version}). Reload and retry.`,
      409
    );
  }

  const setting = toSetting(result.row);
  if (result.outcome === 'updated') {
    logger.info({
      event: 'video_recording_policy.updated',
      previousValue: result.previous.videoRecordingEnabled,
      newValue: setting.enabled,
      version: setting.version,
      adminUserId,
    });
    await notifyVideoRecordingConfigUpdated(setting, 'admin_update');
  }

  return { ...toAdminVideoRecordingView(setting), changed: result.outcome === 'updated' };
}

export async function listVideoRecordingConfigAudit(query: { page?: unknown; limit?: unknown }) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  const { items, total } = await listRecordingPolicyAuditEvents({ page, limit });
  return {
    items: items.map((entry) => {
      const metadata = (entry.metadata ?? {}) as Record<string, unknown>;
      return {
        id: entry.id,
        admin: { userId: entry.adminUserId, email: entry.adminEmail },
        previousValue: metadata.previousValue === true,
        newValue: metadata.newValue === true,
        version: typeof metadata.newVersion === 'number' ? metadata.newVersion : null,
        createdAt: entry.createdAt.toISOString(),
      };
    }),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}
