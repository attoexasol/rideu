/**
 * Admin ride-video visibility + near-live playback unit tests.
 */
import {
  computePlaybackEligibility,
  computeSegmentCounts,
  mapAdminRecordingStatus,
  pickBestSessionForBooking,
} from '../src/services/adminRideVideo.helpers';
import {
  emitAdminRideVideoSegmentUpdated,
  emitAdminRideVideoSessionUpdated,
} from '../src/services/adminRideVideoNotify.service';

jest.mock('../src/services/bookingNotify.service', () => ({
  emitToAdmins: jest.fn().mockResolvedValue(undefined),
  emitToCustomer: jest.fn().mockResolvedValue(undefined),
  emitToDriver: jest.fn().mockResolvedValue(undefined),
}));

const { emitToAdmins } = jest.requireMock('../src/services/bookingNotify.service') as {
  emitToAdmins: jest.Mock;
};

const now = new Date('2026-08-06T12:00:00.000Z');
const baseSegment = {
  durationMs: 10000,
  retentionDeletedAt: null,
  uploadedAt: now,
  recordedAt: now,
};

describe('computePlaybackEligibility', () => {
  it('returns WAITING_FOR_FIRST_SEGMENT for active session with zero segments', () => {
    const result = computePlaybackEligibility({
      sessionStatus: 'active',
      consentStatus: 'granted',
      finalizedAt: null,
      retentionDays: 30,
      segmentDurationSeconds: 10,
      segments: [],
      now,
    });
    expect(result.playbackAvailable).toBe(false);
    expect(result.playbackReason).toBe('WAITING_FOR_FIRST_SEGMENT');
  });

  it('returns RECORDING_ACTIVE when active session has one ready segment', () => {
    const result = computePlaybackEligibility({
      sessionStatus: 'active',
      consentStatus: 'granted',
      finalizedAt: null,
      retentionDays: 30,
      segmentDurationSeconds: 10,
      segments: [{ ...baseSegment, sequenceNumber: 0, uploadStatus: 'verified' }],
      now,
    });
    expect(result.playbackAvailable).toBe(true);
    expect(result.playbackReason).toBe('RECORDING_ACTIVE');
    expect(result.availableSegmentCount).toBe(1);
    expect(result.latestSegmentIndex).toBe(0);
    expect(result.finalized).toBe(false);
  });

  it('supports playback during finalizing when segments are ready', () => {
    const result = computePlaybackEligibility({
      sessionStatus: 'finalizing',
      consentStatus: 'granted',
      finalizedAt: null,
      retentionDays: 30,
      segmentDurationSeconds: 10,
      segments: [
        { ...baseSegment, sequenceNumber: 0, uploadStatus: 'verified' },
        { ...baseSegment, sequenceNumber: 1, uploadStatus: 'pending' },
      ],
      now,
    });
    expect(result.playbackAvailable).toBe(true);
    expect(result.playbackReason).toBe('RECORDING_FINALIZING');
  });

  it('returns RECORDING_READY for finalized completed session', () => {
    const result = computePlaybackEligibility({
      sessionStatus: 'completed',
      consentStatus: 'granted',
      finalizedAt: now,
      retentionDays: 30,
      segmentDurationSeconds: 10,
      segments: [{ ...baseSegment, sequenceNumber: 0, uploadStatus: 'verified' }],
      now,
    });
    expect(result.playbackAvailable).toBe(true);
    expect(result.playbackReason).toBe('RECORDING_READY');
    expect(result.finalized).toBe(true);
  });

  it('returns RECORDING_PARTIAL for finalized session with missing segments', () => {
    const result = computePlaybackEligibility({
      sessionStatus: 'completed',
      consentStatus: 'granted',
      finalizedAt: now,
      retentionDays: 30,
      segmentDurationSeconds: 10,
      segments: [
        { ...baseSegment, sequenceNumber: 0, uploadStatus: 'verified' },
        { ...baseSegment, sequenceNumber: 2, uploadStatus: 'failed' },
      ],
      now,
    });
    expect(result.playbackAvailable).toBe(true);
    expect(result.playbackReason).toBe('RECORDING_PARTIAL');
  });
});

describe('mapAdminRecordingStatus active visibility', () => {
  it('maps active session with playable segments to partially_available', () => {
    const status = mapAdminRecordingStatus({
      sessionStatus: 'active',
      consentStatus: 'granted',
      finalizedAt: null,
      retentionDays: 30,
      segmentDurationSeconds: 10,
      segments: [{ ...baseSegment, sequenceNumber: 0, uploadStatus: 'verified' }],
      now,
    });
    expect(status).toBe('partially_available');
  });

  it('maps finalizing session with segments to partially_available', () => {
    const status = mapAdminRecordingStatus({
      sessionStatus: 'finalizing',
      consentStatus: 'granted',
      finalizedAt: null,
      retentionDays: 30,
      segmentDurationSeconds: 10,
      segments: [{ ...baseSegment, sequenceNumber: 0, uploadStatus: 'uploaded' }],
      now,
    });
    expect(status).toBe('partially_available');
  });
});

describe('pickBestSessionForBooking', () => {
  it('prefers recoverable session over older completed session', () => {
    const sessions = [
      {
        id: 'completed-old',
        status: 'completed',
        createdAt: new Date('2026-08-06T10:00:00Z'),
        finalizedAt: new Date('2026-08-06T10:30:00Z'),
      },
      {
        id: 'active-new',
        status: 'active',
        createdAt: new Date('2026-08-06T11:00:00Z'),
        finalizedAt: null,
      },
    ];
    const counts = new Map([
      ['completed-old', 3],
      ['active-new', 1],
    ]);
    expect(pickBestSessionForBooking(sessions, counts)?.id).toBe('active-new');
  });

  it('prefers completed session with more playable segments when none recoverable', () => {
    const sessions = [
      {
        id: 'completed-a',
        status: 'completed',
        createdAt: new Date('2026-08-06T10:00:00Z'),
        finalizedAt: new Date('2026-08-06T10:30:00Z'),
      },
      {
        id: 'completed-b',
        status: 'completed',
        createdAt: new Date('2026-08-06T09:00:00Z'),
        finalizedAt: new Date('2026-08-06T09:30:00Z'),
      },
    ];
    const counts = new Map([
      ['completed-a', 1],
      ['completed-b', 4],
    ]);
    expect(pickBestSessionForBooking(sessions, counts)?.id).toBe('completed-b');
  });
});

describe('admin ride-video socket events', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('emits admin:ride-video:session_updated without signed URLs', async () => {
    await emitAdminRideVideoSessionUpdated({
      sessionId: 'sess-1',
      bookingId: 'book-1',
      sessionStatus: 'active',
      recordingStatus: 'partially_available',
      playbackAvailable: true,
      availableSegmentCount: 2,
      readySegmentCount: 2,
      latestSegmentIndex: 1,
      finalized: false,
      lastActivityAt: now.toISOString(),
    });
    expect(emitToAdmins).toHaveBeenCalledWith(
      'admin:ride-video:session_updated',
      expect.not.objectContaining({ url: expect.anything() })
    );
  });

  it('emits admin:ride-video:segment_updated after segment readiness', async () => {
    await emitAdminRideVideoSegmentUpdated({
      sessionId: 'sess-1',
      bookingId: 'book-1',
      sessionStatus: 'active',
      segmentId: 'seg-1',
      segmentIndex: 0,
      uploadStatus: 'verified',
      availableSegmentCount: 1,
      readySegmentCount: 1,
      latestSegmentIndex: 0,
      lastActivityAt: now.toISOString(),
    });
    expect(emitToAdmins).toHaveBeenCalledWith(
      'admin:ride-video:segment_available',
      expect.objectContaining({
        segmentId: 'seg-1',
        segmentIndex: 0,
        uploadStatus: 'verified',
      })
    );
  });
});

describe('final partial segment preservation logic', () => {
  it('counts short final segment duration in available playback time', () => {
    const counts = computeSegmentCounts([
      { ...baseSegment, sequenceNumber: 0, uploadStatus: 'verified', durationMs: 10000 },
      { ...baseSegment, sequenceNumber: 1, uploadStatus: 'verified', durationMs: 10000 },
      { ...baseSegment, sequenceNumber: 2, uploadStatus: 'verified', durationMs: 10000 },
      { ...baseSegment, sequenceNumber: 3, uploadStatus: 'verified', durationMs: 6000 },
    ]);
    expect(counts.availableDurationSeconds).toBe(36);
    expect(counts.playableSegmentCount).toBe(4);
  });
});
