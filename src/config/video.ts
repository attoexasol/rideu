import path from 'path';
import { getEnvVarAsBoolean, getEnvVarAsNumber } from './env-validator';

const segmentDurationSeconds = getEnvVarAsNumber('VIDEO_SEGMENT_DURATION_SECONDS', 10);
const maxSegmentSizeBytes = getEnvVarAsNumber('VIDEO_MAX_SEGMENT_SIZE_BYTES', 25_000_000);
const uploadUrlTtlSeconds = getEnvVarAsNumber('VIDEO_UPLOAD_URL_TTL_SECONDS', 300);
const readUrlTtlSeconds = getEnvVarAsNumber('VIDEO_READ_URL_TTL_SECONDS', 300);
const retentionDays = getEnvVarAsNumber('VIDEO_RETENTION_DAYS', 30);
const uploadGracePeriodSeconds = getEnvVarAsNumber('VIDEO_UPLOAD_GRACE_PERIOD_SECONDS', 120);
const staleRegisteredSegmentSeconds = getEnvVarAsNumber('VIDEO_STALE_REGISTERED_SEGMENT_SECONDS', 600);
const staleUploadingSegmentSeconds = getEnvVarAsNumber('VIDEO_STALE_UPLOADING_SEGMENT_SECONDS', 300);
const manifestRefreshSeconds = getEnvVarAsNumber('VIDEO_MANIFEST_REFRESH_SECONDS', 5);
const recoveryPollIntervalSeconds = getEnvVarAsNumber('VIDEO_RECOVERY_POLL_INTERVAL_SECONDS', 30);

for (const [name, value] of Object.entries({
  VIDEO_SEGMENT_DURATION_SECONDS: segmentDurationSeconds,
  VIDEO_MAX_SEGMENT_SIZE_BYTES: maxSegmentSizeBytes,
  VIDEO_UPLOAD_URL_TTL_SECONDS: uploadUrlTtlSeconds,
  VIDEO_READ_URL_TTL_SECONDS: readUrlTtlSeconds,
  VIDEO_RETENTION_DAYS: retentionDays,
  VIDEO_UPLOAD_GRACE_PERIOD_SECONDS: uploadGracePeriodSeconds,
  VIDEO_STALE_REGISTERED_SEGMENT_SECONDS: staleRegisteredSegmentSeconds,
  VIDEO_STALE_UPLOADING_SEGMENT_SECONDS: staleUploadingSegmentSeconds,
  VIDEO_MANIFEST_REFRESH_SECONDS: manifestRefreshSeconds,
  VIDEO_RECOVERY_POLL_INTERVAL_SECONDS: recoveryPollIntervalSeconds,
})) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
}

export const videoConfig = {
  enabled: getEnvVarAsBoolean('VIDEO_RECORDING_ENABLED', false),
  consentRequired: getEnvVarAsBoolean('VIDEO_RECORDING_CONSENT_REQUIRED', true),
  segmentDurationSeconds,
  maxSegmentSizeBytes,
  uploadUrlTtlSeconds,
  readUrlTtlSeconds,
  retentionDays,
  uploadGracePeriodSeconds,
  staleRegisteredSegmentSeconds,
  staleUploadingSegmentSeconds,
  manifestRefreshSeconds,
  recoveryPollIntervalSeconds,
  storageContainer: process.env.VIDEO_STORAGE_CONTAINER || 'ride-recordings',
  storageRoot: path.resolve(process.env.VIDEO_STORAGE_ROOT || 'private-media'),
  allowedMimeTypes: new Set(['video/mp4', 'video/quicktime']),
} as const;
