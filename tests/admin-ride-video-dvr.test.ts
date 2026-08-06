/**
 * DVR-style ride video playback unit tests.
 */
import {
  buildDvrTimeline,
  resolveTerminalSessionStatus,
  segmentDurationSeconds,
  sliceDvrManifest,
} from '../src/services/rideVideoDvr.helpers';

describe('segmentDurationSeconds', () => {
  it('accepts short final partial segments', () => {
    expect(segmentDurationSeconds(7000, 10)).toBe(7);
    expect(segmentDurationSeconds(6000, 10)).toBe(6);
  });

  it('falls back to default when duration missing', () => {
    expect(segmentDurationSeconds(null, 10)).toBe(10);
  });
});

describe('buildDvrTimeline live edge', () => {
  it('computes live edge from verified segments including partial tail', () => {
    const timeline = buildDvrTimeline({
      sessionStatus: 'active',
      finalizedAt: null,
      defaultSegmentDurationSeconds: 10,
      segments: [
        {
          segmentId: 'a',
          segmentIndex: 0,
          durationMs: 10000,
          mimeType: 'video/mp4',
          uploadStatus: 'verified',
          storageKey: 'k0',
          retentionDeletedAt: null,
        },
        {
          segmentId: 'b',
          segmentIndex: 1,
          durationMs: 10000,
          mimeType: 'video/mp4',
          uploadStatus: 'verified',
          storageKey: 'k1',
          retentionDeletedAt: null,
        },
        {
          segmentId: 'c',
          segmentIndex: 2,
          durationMs: 7000,
          mimeType: 'video/mp4',
          uploadStatus: 'verified',
          storageKey: 'k2',
          retentionDeletedAt: null,
        },
      ],
    });

    expect(timeline.liveEdgeSeconds).toBe(27);
    expect(timeline.recordingActive).toBe(true);
    expect(timeline.finalized).toBe(false);
    expect(timeline.latestAvailableSegmentIndex).toBe(2);
    expect(timeline.firstAvailableSegmentIndex).toBe(0);
  });
});

describe('sliceDvrManifest rewind and incremental refresh', () => {
  const timeline = buildDvrTimeline({
    sessionStatus: 'active',
    finalizedAt: null,
    defaultSegmentDurationSeconds: 10,
    segments: [
      {
        segmentId: 'a',
        segmentIndex: 0,
        durationMs: 10000,
        mimeType: 'video/mp4',
        uploadStatus: 'verified',
        storageKey: 'k0',
        retentionDeletedAt: null,
      },
      {
        segmentId: 'b',
        segmentIndex: 1,
        durationMs: 10000,
        mimeType: 'video/mp4',
        uploadStatus: 'verified',
        storageKey: 'k1',
        retentionDeletedAt: null,
      },
      {
        segmentId: 'c',
        segmentIndex: 2,
        durationMs: 10000,
        mimeType: 'video/mp4',
        uploadStatus: 'verified',
        storageKey: 'k2',
        retentionDeletedAt: null,
      },
    ],
  });

  it('plays from segment zero', () => {
    const slice = sliceDvrManifest(timeline, { fromSegmentIndex: 0, limit: 10 });
    expect(slice.segments).toHaveLength(3);
    expect(slice.segments[0].segmentIndex).toBe(0);
  });

  it('supports rewind from earlier offset', () => {
    const slice = sliceDvrManifest(timeline, { fromOffsetSeconds: 15, limit: 10 });
    expect(slice.segments.map((s) => s.segmentIndex)).toEqual([1, 2]);
  });

  it('returns unchanged when manifest version matches', () => {
    const slice = sliceDvrManifest(timeline, {
      sinceManifestVersion: 8,
      currentManifestVersion: 8,
    });
    expect(slice.unchanged).toBe(true);
    expect(slice.segments).toHaveLength(0);
  });

  it('returns only newest segment on incremental refresh', () => {
    const slice = sliceDvrManifest(timeline, {
      sinceManifestVersion: 7,
      currentManifestVersion: 8,
      limit: 10,
    });
    expect(slice.unchanged).toBe(false);
    expect(slice.segments).toHaveLength(1);
    expect(slice.segments[0].segmentIndex).toBe(2);
  });
});

describe('resolveTerminalSessionStatus', () => {
  it('marks completed when all segments verified contiguous', () => {
    expect(
      resolveTerminalSessionStatus({
        pendingCount: 0,
        defaultSegmentDurationSeconds: 10,
        segments: [
          {
            segmentId: 'a',
            segmentIndex: 0,
            durationMs: 10000,
            mimeType: 'video/mp4',
            uploadStatus: 'verified',
            storageKey: 'k0',
            retentionDeletedAt: null,
          },
          {
            segmentId: 'b',
            segmentIndex: 1,
            durationMs: 10000,
            mimeType: 'video/mp4',
            uploadStatus: 'verified',
            storageKey: 'k1',
            retentionDeletedAt: null,
          },
        ],
      })
    ).toBe('completed');
  });

  it('marks partial when gaps or failures exist but playable segments remain', () => {
    expect(
      resolveTerminalSessionStatus({
        pendingCount: 0,
        defaultSegmentDurationSeconds: 10,
        segments: [
          {
            segmentId: 'a',
            segmentIndex: 0,
            durationMs: 10000,
            mimeType: 'video/mp4',
            uploadStatus: 'verified',
            storageKey: 'k0',
            retentionDeletedAt: null,
          },
          {
            segmentId: 'b',
            segmentIndex: 2,
            durationMs: 7000,
            mimeType: 'video/mp4',
            uploadStatus: 'verified',
            storageKey: 'k2',
            retentionDeletedAt: null,
          },
        ],
      })
    ).toBe('partial');
  });

  it('marks failed when nothing playable', () => {
    expect(
      resolveTerminalSessionStatus({
        pendingCount: 0,
        defaultSegmentDurationSeconds: 10,
        segments: [
          {
            segmentId: 'a',
            segmentIndex: 0,
            durationMs: 10000,
            mimeType: 'video/mp4',
            uploadStatus: 'failed',
            storageKey: null,
            retentionDeletedAt: null,
          },
        ],
      })
    ).toBe('failed');
  });
});
