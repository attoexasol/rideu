/**
 * Admin ride-video helpers + permission mapping unit tests.
 */
import {
  computeHealthState,
  computeRetention,
  computeSegmentCounts,
  computeUploadHealth,
  detectMissingSequences,
  mapAdminRecordingStatus,
  mapConsentForAdmin,
} from '../src/services/adminRideVideo.helpers';
import {
  RideVideoPermissions,
  hasRideVideoPermission,
  resolveRideVideoPermissions,
} from '../src/constants/rideVideoPermissions';

describe('detectMissingSequences', () => {
  it('detects gaps in segment sequence', () => {
    expect(detectMissingSequences([1, 2, 3, 5])).toEqual([4]);
    expect(detectMissingSequences([0, 1, 2])).toEqual([]);
    expect(detectMissingSequences([])).toEqual([]);
  });
});

describe('computeSegmentCounts', () => {
  it('counts uploaded/ready/failed/missing correctly', () => {
    const counts = computeSegmentCounts([
      {
        sequenceNumber: 0,
        uploadStatus: 'verified',
        durationMs: 10000,
        retentionDeletedAt: null,
        uploadedAt: new Date(),
        recordedAt: new Date(),
      },
      {
        sequenceNumber: 1,
        uploadStatus: 'failed',
        durationMs: 10000,
        retentionDeletedAt: null,
        uploadedAt: null,
        recordedAt: new Date(),
      },
      {
        sequenceNumber: 3,
        uploadStatus: 'uploaded',
        durationMs: 10000,
        retentionDeletedAt: null,
        uploadedAt: new Date(),
        recordedAt: new Date(),
      },
    ]);
    expect(counts.expectedSegmentCount).toBe(4);
    expect(counts.missingSegmentCount).toBe(1);
    expect(counts.missingSequences).toEqual([2]);
    expect(counts.failedSegmentCount).toBe(1);
    expect(counts.readySegmentCount).toBe(1);
    expect(counts.uploadedSegmentCount).toBe(2);
  });
});

describe('health calculation', () => {
  const baseSegments = [
    {
      sequenceNumber: 0,
      uploadStatus: 'verified',
      durationMs: 10000,
      retentionDeletedAt: null,
      uploadedAt: new Date(),
      recordedAt: new Date(),
    },
    {
      sequenceNumber: 1,
      uploadStatus: 'verified',
      durationMs: 10000,
      retentionDeletedAt: null,
      uploadedAt: new Date(),
      recordedAt: new Date(),
    },
  ];

  it('marks completed full session healthy', () => {
    const health = computeHealthState({
      sessionStatus: 'completed',
      consentStatus: 'granted',
      finalizedAt: new Date(),
      retentionDays: 30,
      segmentDurationSeconds: 10,
      segments: baseSegments,
    });
    expect(health.state).toBe('healthy');
    expect(health.completenessPercentage).toBe(100);
  });

  it('does not mark partial session healthy', () => {
    const health = computeHealthState({
      sessionStatus: 'completed',
      consentStatus: 'granted',
      finalizedAt: new Date(),
      retentionDays: 30,
      segmentDurationSeconds: 10,
      segments: [
        baseSegments[0],
        {
          sequenceNumber: 2,
          uploadStatus: 'verified',
          durationMs: 10000,
          retentionDeletedAt: null,
          uploadedAt: new Date(),
          recordedAt: new Date(),
        },
      ],
    });
    expect(health.state).toBe('partial');
    expect(health.completenessPercentage).toBeLessThan(100);
  });

  it('marks failed segments as failed', () => {
    const uploadHealth = computeUploadHealth({
      sessionStatus: 'completed',
      consentStatus: 'granted',
      finalizedAt: new Date(),
      retentionDays: 30,
      segmentDurationSeconds: 10,
      segments: [
        {
          sequenceNumber: 0,
          uploadStatus: 'failed',
          durationMs: null,
          retentionDeletedAt: null,
          uploadedAt: null,
          recordedAt: new Date(),
        },
      ],
    });
    expect(uploadHealth).toBe('failed_segments');
  });

  it('detects upload delay on active sessions', () => {
    const old = new Date(Date.now() - 120_000);
    const uploadHealth = computeUploadHealth({
      sessionStatus: 'active',
      consentStatus: 'granted',
      finalizedAt: null,
      retentionDays: 30,
      segmentDurationSeconds: 10,
      uploadDelaySeconds: 45,
      segments: [
        {
          sequenceNumber: 0,
          uploadStatus: 'verified',
          durationMs: 10000,
          retentionDeletedAt: null,
          uploadedAt: old,
          recordedAt: old,
        },
      ],
    });
    expect(uploadHealth).toBe('delayed');
  });
});

describe('retention', () => {
  it('flags expiring soon and expired', () => {
    const now = new Date('2026-08-04T00:00:00.000Z');
    const soon = computeRetention({
      finalizedAt: new Date('2026-07-10T00:00:00.000Z'),
      retentionDays: 30,
      segments: [{ retentionDeletedAt: null }],
      now,
    });
    expect(soon.retentionStatus).toBe('expiring_soon');

    const expired = computeRetention({
      finalizedAt: new Date('2026-06-01T00:00:00.000Z'),
      retentionDays: 30,
      segments: [{ retentionDeletedAt: null }],
      now,
    });
    expect(expired.retentionStatus).toBe('expired');
  });

  it('flags deleted when all media purged', () => {
    const result = computeRetention({
      finalizedAt: new Date(),
      retentionDays: 30,
      segments: [{ retentionDeletedAt: new Date() }],
    });
    expect(result.retentionStatus).toBe('deleted');
  });
});

describe('status mapping', () => {
  it('maps waiting for consent', () => {
    expect(
      mapAdminRecordingStatus({
        sessionStatus: 'pending',
        consentStatus: 'required',
        finalizedAt: null,
        retentionDays: 30,
        segmentDurationSeconds: 10,
        segments: [],
      })
    ).toBe('waiting_for_consent');
  });

  it('maps consent for admin UI', () => {
    expect(mapConsentForAdmin('required')).toBe('pending');
    expect(mapConsentForAdmin('granted')).toBe('granted');
  });
});

describe('ride video permissions', () => {
  it('maps admin role to view/play/audit only', () => {
    const granted = resolveRideVideoPermissions({ role: 'admin', permissions: [] });
    expect(granted.has(RideVideoPermissions.VIEW)).toBe(true);
    expect(granted.has(RideVideoPermissions.PLAY)).toBe(true);
    expect(granted.has(RideVideoPermissions.AUDIT)).toBe(true);
    expect(granted.has(RideVideoPermissions.DOWNLOAD)).toBe(false);
    expect(granted.has(RideVideoPermissions.DELETE)).toBe(false);
  });

  it('maps super_admin to all permissions', () => {
    expect(
      hasRideVideoPermission({ role: 'super_admin' }, RideVideoPermissions.DELETE)
    ).toBe(true);
    expect(
      hasRideVideoPermission({ role: 'super_admin' }, RideVideoPermissions.DOWNLOAD)
    ).toBe(true);
  });

  it('treats explicit JWT permissions as authoritative', () => {
    const granted = resolveRideVideoPermissions({
      role: 'admin',
      permissions: [RideVideoPermissions.VIEW],
    });
    expect(granted.has(RideVideoPermissions.VIEW)).toBe(true);
    expect(granted.has(RideVideoPermissions.PLAY)).toBe(false);
  });
});
