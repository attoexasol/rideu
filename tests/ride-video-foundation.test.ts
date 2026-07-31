/**
 * Ride-video recording foundation — unit/contract tests without a real database.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createHash, createHmac } from 'crypto';
import { BookingStatus } from '../src/constants/bookingStatus';

const selectQueue: unknown[][] = [];
const insertQueue: unknown[][] = [];
const updateQueue: unknown[][] = [];

const mockFindBookingById = jest.fn();
const mockEmitToDriver = jest.fn().mockResolvedValue(undefined);
const mockEmitToCustomer = jest.fn().mockResolvedValue(undefined);
const mockEmitToAdmins = jest.fn().mockResolvedValue(undefined);
const mockSavePrivateSegment = jest.fn();
const mockInspectPrivateSegment = jest.fn();

const videoConfigState = {
  enabled: true,
  consentRequired: true,
  segmentDurationSeconds: 10,
  maxSegmentSizeBytes: 1_000_000,
  uploadUrlTtlSeconds: 300,
  readUrlTtlSeconds: 120,
  retentionDays: 30,
  storageContainer: 'ride-recordings',
  storageRoot: path.join(os.tmpdir(), 'ride-video-foundation-tests'),
  allowedMimeTypes: new Set(['video/mp4', 'video/quicktime']),
};

function thenableChain(getResult: () => unknown) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.from = jest.fn(self);
  chain.where = jest.fn(self);
  chain.orderBy = jest.fn(self);
  chain.limit = jest.fn(self);
  chain.set = jest.fn(self);
  chain.values = jest.fn(self);
  chain.returning = jest.fn(async () => getResult());
  chain.then = (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
    Promise.resolve(getResult()).then(onFulfilled, onRejected);
  return chain;
}

const mockDb: {
  select: jest.Mock;
  insert: jest.Mock;
  update: jest.Mock;
  transaction: jest.Mock;
} = {
  select: jest.fn(() => thenableChain(() => selectQueue.shift() ?? [])),
  insert: jest.fn(() => thenableChain(() => insertQueue.shift() ?? [])),
  update: jest.fn(() => thenableChain(() => updateQueue.shift() ?? [])),
  transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(mockDb)),
};

jest.mock('../src/config/video', () => ({
  videoConfig: videoConfigState,
}));

jest.mock('../src/db/connection', () => ({
  db: mockDb,
}));

jest.mock('../src/repositories/booking.repository', () => ({
  findBookingById: (...args: unknown[]) => mockFindBookingById(...args),
}));

jest.mock('../src/services/bookingNotify.service', () => ({
  emitToDriver: (...args: unknown[]) => mockEmitToDriver(...args),
  emitToCustomer: (...args: unknown[]) => mockEmitToCustomer(...args),
  emitToAdmins: (...args: unknown[]) => mockEmitToAdmins(...args),
}));

jest.mock('../src/middleware/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../src/services/ride-video-storage.service', () => {
  const actual = jest.requireActual('../src/services/ride-video-storage.service') as Record<
    string,
    unknown
  >;
  return {
    ...actual,
    savePrivateSegment: (...args: unknown[]) => mockSavePrivateSegment(...args),
    inspectPrivateSegment: (...args: unknown[]) => mockInspectPrivateSegment(...args),
  };
});

function resetQueues() {
  selectQueue.length = 0;
  insertQueue.length = 0;
  updateQueue.length = 0;
}

function enqueueSelect(...batches: unknown[][]) {
  selectQueue.push(...batches);
}

function enqueueInsert(...batches: unknown[][]) {
  insertQueue.push(...batches);
}

function enqueueUpdate(...batches: unknown[][]) {
  updateQueue.push(...batches);
}

function makeBooking(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    status: BookingStatus.IN_PROGRESS,
    assignedDriverId: '22222222-2222-4222-8222-222222222222',
    customerId: '33333333-3333-4333-8333-333333333333',
    linkedTripId: '44444444-4444-4444-8444-444444444444',
    recordingConsentStatus: 'granted',
    recordingConsentedAt: new Date('2026-07-30T10:00:00.000Z'),
    ...overrides,
  };
}

function makeSession(overrides: Record<string, unknown> = {}) {
  const now = new Date('2026-07-30T12:00:00.000Z');
  return {
    id: '55555555-5555-4555-8555-555555555555',
    tripId: '44444444-4444-4444-8444-444444444444',
    bookingId: '11111111-1111-4111-8111-111111111111',
    driverId: '22222222-2222-4222-8222-222222222222',
    passengerId: '33333333-3333-4333-8333-333333333333',
    status: 'active',
    consentStatus: 'granted',
    startedAt: now,
    pausedAt: null,
    endedAt: null,
    finalizedAt: null,
    failureReason: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeSegment(overrides: Record<string, unknown> = {}) {
  const now = new Date('2026-07-30T12:05:00.000Z');
  return {
    id: '66666666-6666-4666-8666-666666666666',
    sessionId: '55555555-5555-4555-8555-555555555555',
    bookingId: '11111111-1111-4111-8111-111111111111',
    driverId: '22222222-2222-4222-8222-222222222222',
    sequenceNumber: 0,
    clientSegmentId: '77777777-7777-4777-8777-777777777777',
    storageKey: 'ride-recordings/booking/session/0-seg.mp4',
    uploadStatus: 'pending',
    durationMs: 10_000,
    fileSizeBytes: 100,
    mimeType: 'video/mp4',
    checksum: null,
    recordedAt: now,
    uploadedAt: null,
    retentionDeletedAt: null,
    retryCount: 0,
    failureReason: null,
    videoUrl: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

async function loadService() {
  return import('../src/services/rideVideo.service');
}

async function loadStorage() {
  return import('../src/services/ride-video-storage.service');
}

beforeEach(() => {
  jest.clearAllMocks();
  resetQueues();
  videoConfigState.enabled = true;
  videoConfigState.consentRequired = true;
  videoConfigState.maxSegmentSizeBytes = 1_000_000;
  videoConfigState.uploadUrlTtlSeconds = 300;
  mockSavePrivateSegment.mockResolvedValue({
    fileSizeBytes: 100,
    checksum: createHash('sha256').update(Buffer.alloc(100)).digest('hex'),
  });
  mockInspectPrivateSegment.mockResolvedValue({
    fileSizeBytes: 100,
    absolutePath: path.join(videoConfigState.storageRoot, 'object.mp4'),
  });
});

describe('ride video config', () => {
  it('exposes foundation defaults used by clients', () => {
    expect(videoConfigState.segmentDurationSeconds).toBe(10);
    expect(videoConfigState.uploadUrlTtlSeconds).toBe(300);
    expect(videoConfigState.allowedMimeTypes.has('video/mp4')).toBe(true);
    expect(videoConfigState.allowedMimeTypes.has('video/quicktime')).toBe(true);
    expect(videoConfigState.storageContainer).toBe('ride-recordings');
  });
});

describe('authorization and ownership', () => {
  const driverId = '22222222-2222-4222-8222-222222222222';
  const bookingId = '11111111-1111-4111-8111-111111111111';

  it('rejects unassigned driver creating a session', async () => {
    const { createOrRestoreRideVideoSession, RideVideoError } = await loadService();
    mockFindBookingById.mockResolvedValue(
      makeBooking({ assignedDriverId: '99999999-9999-4999-8999-999999999999' })
    );

    await expect(createOrRestoreRideVideoSession(bookingId, driverId)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      statusCode: 403,
    } satisfies Partial<InstanceType<typeof RideVideoError>>);
  });

  it('rejects old / wrong driver accessing another driver session', async () => {
    const { pauseRideVideoSession, RideVideoError } = await loadService();
    enqueueSelect([makeSession({ driverId: '99999999-9999-4999-8999-999999999999' })]);

    await expect(
      pauseRideVideoSession('55555555-5555-4555-8555-555555555555', driverId)
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      statusCode: 403,
    } satisfies Partial<InstanceType<typeof RideVideoError>>);
  });

  it('rejects status poll for unassigned driver', async () => {
    const { getRideVideoSessionStatus } = await loadService();
    mockFindBookingById.mockResolvedValue(
      makeBooking({ assignedDriverId: '99999999-9999-4999-8999-999999999999' })
    );

    await expect(getRideVideoSessionStatus(bookingId, driverId)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      statusCode: 403,
    });
  });
});

describe('session idempotency', () => {
  const driverId = '22222222-2222-4222-8222-222222222222';
  const bookingId = '11111111-1111-4111-8111-111111111111';

  it('restores an existing recoverable session instead of inserting', async () => {
    const { createOrRestoreRideVideoSession } = await loadService();
    const existing = makeSession();
    mockFindBookingById.mockResolvedValue(makeBooking());
    enqueueSelect([existing]);

    const result = await createOrRestoreRideVideoSession(bookingId, driverId);

    expect(result.id).toBe(existing.id);
    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(mockEmitToDriver).not.toHaveBeenCalled();
  });

  it('creates a session when none is recoverable', async () => {
    const { createOrRestoreRideVideoSession } = await loadService();
    const created = makeSession();
    mockFindBookingById.mockResolvedValue(makeBooking());
    enqueueSelect([]); // findRecoverableSession
    enqueueSelect([]); // inside transaction
    enqueueInsert([created]);

    const result = await createOrRestoreRideVideoSession(bookingId, driverId);

    expect(result.id).toBe(created.id);
    expect(result.status).toBe('active');
    expect(mockEmitToDriver).toHaveBeenCalledWith(
      driverId,
      'recording:session_started',
      expect.objectContaining({ bookingId, sessionId: created.id })
    );
  });

  it('recovers from unique-violation race by reloading session', async () => {
    const { createOrRestoreRideVideoSession } = await loadService();
    const raced = makeSession();
    mockFindBookingById.mockResolvedValue(makeBooking());
    enqueueSelect([]); // outer findRecoverableSession
    enqueueSelect([]); // tx find
    mockDb.insert.mockImplementationOnce(() => {
      const err = Object.assign(new Error('duplicate'), { code: '23505' });
      return thenableChain(() => {
        throw err;
      });
    });
    enqueueSelect([raced]); // after race

    const result = await createOrRestoreRideVideoSession(bookingId, driverId);
    expect(result.id).toBe(raced.id);
  });
});

describe('consent blocking', () => {
  const driverId = '22222222-2222-4222-8222-222222222222';
  const bookingId = '11111111-1111-4111-8111-111111111111';

  it('blocks when consent is still required', async () => {
    const { createOrRestoreRideVideoSession } = await loadService();
    mockFindBookingById.mockResolvedValue(
      makeBooking({ recordingConsentStatus: 'required', recordingConsentedAt: null })
    );

    await expect(createOrRestoreRideVideoSession(bookingId, driverId)).rejects.toMatchObject({
      code: 'RECORDING_CONSENT_REQUIRED',
      statusCode: 409,
    });
  });

  it('blocks when passenger denied consent', async () => {
    const { createOrRestoreRideVideoSession } = await loadService();
    mockFindBookingById.mockResolvedValue(
      makeBooking({ recordingConsentStatus: 'denied', recordingConsentedAt: null })
    );

    await expect(createOrRestoreRideVideoSession(bookingId, driverId)).rejects.toMatchObject({
      code: 'RECORDING_CONSENT_DENIED',
      statusCode: 409,
    });
  });

  it('allows recording when consent is not required by config', async () => {
    videoConfigState.consentRequired = false;
    const { createOrRestoreRideVideoSession } = await loadService();
    const created = makeSession({ consentStatus: 'not_required' });
    mockFindBookingById.mockResolvedValue(
      makeBooking({ recordingConsentStatus: 'required', recordingConsentedAt: null })
    );
    enqueueSelect([]);
    enqueueSelect([]);
    enqueueInsert([created]);

    await expect(createOrRestoreRideVideoSession(bookingId, driverId)).resolves.toMatchObject({
      id: created.id,
    });
  });
});

describe('segment idempotency and sequence conflicts', () => {
  const driverId = '22222222-2222-4222-8222-222222222222';
  const sessionId = '55555555-5555-4555-8555-555555555555';
  const input = {
    clientSegmentId: '77777777-7777-4777-8777-777777777777',
    sequenceNumber: 0,
    mimeType: 'video/mp4',
    fileSizeBytes: 100,
  };

  it('returns existing upload details for same clientSegmentId + sequence', async () => {
    const { registerRideVideoSegment } = await loadService();
    const existing = makeSegment();
    mockFindBookingById.mockResolvedValue(makeBooking());
    enqueueSelect([makeSession()]); // getOwnedSession
    enqueueSelect([existing]); // duplicates

    const result = await registerRideVideoSegment(sessionId, driverId, input);

    expect(result.segment.id).toBe(existing.id);
    expect(result.upload.method).toBe('PUT');
    expect(result.upload.url).toContain(`/segments/${existing.id}/upload?token=`);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('rejects clientSegmentId reused with a different sequence', async () => {
    const { registerRideVideoSegment } = await loadService();
    mockFindBookingById.mockResolvedValue(makeBooking());
    enqueueSelect([makeSession()]);
    enqueueSelect([makeSegment({ sequenceNumber: 0 })]);

    await expect(
      registerRideVideoSegment(sessionId, driverId, { ...input, sequenceNumber: 1 })
    ).rejects.toMatchObject({ code: 'SEGMENT_IDEMPOTENCY_CONFLICT', statusCode: 409 });
  });

  it('rejects sequence owned by another clientSegmentId', async () => {
    const { registerRideVideoSegment } = await loadService();
    mockFindBookingById.mockResolvedValue(makeBooking());
    enqueueSelect([makeSession()]);
    enqueueSelect([
      makeSegment({
        clientSegmentId: '88888888-8888-4888-8888-888888888888',
        sequenceNumber: 0,
      }),
    ]);

    await expect(registerRideVideoSegment(sessionId, driverId, input)).rejects.toMatchObject({
      code: 'SEGMENT_SEQUENCE_CONFLICT',
      statusCode: 409,
    });
  });
});

describe('MIME and size validation', () => {
  const driverId = '22222222-2222-4222-8222-222222222222';
  const sessionId = '55555555-5555-4555-8555-555555555555';

  it('rejects unsupported MIME types', async () => {
    const { registerRideVideoSegment } = await loadService();
    mockFindBookingById.mockResolvedValue(makeBooking());
    enqueueSelect([makeSession()]);

    await expect(
      registerRideVideoSegment(sessionId, driverId, {
        clientSegmentId: '77777777-7777-4777-8777-777777777777',
        sequenceNumber: 0,
        mimeType: 'video/webm',
      })
    ).rejects.toMatchObject({ code: 'INVALID_VIDEO_MIME_TYPE', statusCode: 400 });
  });

  it('rejects oversized registered segments', async () => {
    const { registerRideVideoSegment } = await loadService();
    mockFindBookingById.mockResolvedValue(makeBooking());
    enqueueSelect([makeSession()]);

    await expect(
      registerRideVideoSegment(sessionId, driverId, {
        clientSegmentId: '77777777-7777-4777-8777-777777777777',
        sequenceNumber: 0,
        mimeType: 'video/mp4',
        fileSizeBytes: videoConfigState.maxSegmentSizeBytes + 1,
      })
    ).rejects.toMatchObject({ code: 'VIDEO_SEGMENT_TOO_LARGE', statusCode: 413 });
  });

  it('rejects upload Content-Type mismatch and oversize buffer', async () => {
    const { uploadRideVideoSegment } = await loadService();
    const { createUploadToken } = await loadStorage();
    const segment = makeSegment({ mimeType: 'video/mp4', fileSizeBytes: 50 });
    mockFindBookingById.mockResolvedValue(makeBooking());
    enqueueSelect([segment], [makeSession()]);
    const { token } = createUploadToken({
      segmentId: segment.id as string,
      driverId,
      storageKey: segment.storageKey as string,
    });

    await expect(
      uploadRideVideoSegment({
        segmentId: segment.id as string,
        driverId,
        token,
        mimeType: 'video/quicktime',
        buffer: Buffer.alloc(50),
      })
    ).rejects.toMatchObject({ code: 'INVALID_VIDEO_MIME_TYPE' });

    enqueueSelect([segment], [makeSession()]);
    await expect(
      uploadRideVideoSegment({
        segmentId: segment.id as string,
        driverId,
        token,
        mimeType: 'video/mp4',
        buffer: Buffer.alloc(videoConfigState.maxSegmentSizeBytes + 1),
      })
    ).rejects.toMatchObject({ code: 'VIDEO_SEGMENT_TOO_LARGE', statusCode: 413 });
  });
});

describe('upload token TTL and binding', () => {
  const driverId = '22222222-2222-4222-8222-222222222222';
  const segmentId = '66666666-6666-4666-8666-666666666666';
  const storageKey = 'ride-recordings/b/s/0-seg.mp4';

  it('creates upload tokens bound to segment, driver, and storage key', async () => {
    const { createUploadToken, verifyStorageToken } = await loadStorage();
    const { token, expiresAt } = createUploadToken({ segmentId, driverId, storageKey });

    expect(expiresAt.toISOString()).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(expiresAt.getTime() - Date.now()).toBeGreaterThan(250_000);
    expect(expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(300_000 + 50);

    const payload = verifyStorageToken(token, {
      purpose: 'upload',
      segmentId,
      storageKey,
      driverId,
    });
    expect(payload.purpose).toBe('upload');
    expect(payload.segmentId).toBe(segmentId);
  });

  it('rejects wrong binding and expired tokens', async () => {
    const { createUploadToken, verifyStorageToken } = await loadStorage();
    const { token } = createUploadToken({ segmentId, driverId, storageKey });

    expect(() =>
      verifyStorageToken(token, {
        purpose: 'upload',
        segmentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        storageKey,
        driverId,
      })
    ).toThrow(/does not match/);

    expect(() =>
      verifyStorageToken(token, {
        purpose: 'read',
        segmentId,
        storageKey,
      })
    ).toThrow(/does not match/);

    jest.useFakeTimers();
    try {
      const fresh = createUploadToken({ segmentId, driverId, storageKey });
      jest.advanceTimersByTime(videoConfigState.uploadUrlTtlSeconds * 1000 + 1000);
      expect(() =>
        verifyStorageToken(fresh.token, {
          purpose: 'upload',
          segmentId,
          storageKey,
          driverId,
        })
      ).toThrow(/expired/);
    } finally {
      jest.useRealTimers();
    }
  });

  it('rejects forged signatures', async () => {
    const { verifyStorageToken } = await loadStorage();
    const payload = Buffer.from(
      JSON.stringify({
        purpose: 'upload',
        segmentId,
        storageKey,
        driverId,
        exp: Math.floor(Date.now() / 1000) + 60,
      })
    ).toString('base64url');
    const forged = `${payload}.${createHmac('sha256', 'wrong-secret').update(payload).digest('base64url')}`;

    expect(() =>
      verifyStorageToken(forged, { purpose: 'upload', segmentId, storageKey, driverId })
    ).toThrow(/Invalid video storage token/);
  });
});

describe('upload completion storage metadata', () => {
  const driverId = '22222222-2222-4222-8222-222222222222';

  it('persists uploaded checksum/size metadata after successful PUT', async () => {
    const { uploadRideVideoSegment } = await loadService();
    const { createUploadToken } = await loadStorage();
    const buffer = Buffer.from('ride-video-bytes');
    const checksum = createHash('sha256').update(buffer).digest('hex');
    const segment = makeSegment({ fileSizeBytes: buffer.length, checksum: null });
    const uploaded = makeSegment({
      uploadStatus: 'uploaded',
      fileSizeBytes: buffer.length,
      checksum,
      uploadedAt: new Date('2026-07-30T12:10:00.000Z'),
    });
    mockFindBookingById.mockResolvedValue(makeBooking());
    enqueueSelect([segment], [makeSession()]);
    enqueueUpdate([uploaded]);
    mockSavePrivateSegment.mockResolvedValue({ fileSizeBytes: buffer.length, checksum });
    const { token } = createUploadToken({
      segmentId: segment.id as string,
      driverId,
      storageKey: segment.storageKey as string,
    });

    const result = await uploadRideVideoSegment({
      segmentId: segment.id as string,
      driverId,
      token,
      mimeType: 'video/mp4',
      buffer,
    });

    expect(mockSavePrivateSegment).toHaveBeenCalledWith(segment.storageKey, buffer);
    expect(result.uploadStatus).toBe('uploaded');
    expect(result.checksum).toBe(checksum);
    expect(result.fileSizeBytes).toBe(buffer.length);
    expect(result.uploadedAt).toBe('2026-07-30T12:10:00.000Z');
  });

  it('verifies stored object metadata on complete', async () => {
    const { completeRideVideoSegment } = await loadService();
    const segment = makeSegment({ uploadStatus: 'uploaded', fileSizeBytes: 100, checksum: 'abc' });
    const verified = makeSegment({
      uploadStatus: 'verified',
      fileSizeBytes: 100,
      checksum: 'abc',
      uploadedAt: new Date('2026-07-30T12:10:00.000Z'),
    });
    enqueueSelect([makeSession()]);
    enqueueSelect([segment]);
    enqueueUpdate([verified]);
    mockInspectPrivateSegment.mockResolvedValue({
      fileSizeBytes: 100,
      absolutePath: '/tmp/object.mp4',
    });

    const result = await completeRideVideoSegment(
      segment.sessionId as string,
      segment.id as string,
      driverId,
      { fileSizeBytes: 100 }
    );

    expect(result.uploadStatus).toBe('verified');
    expect(mockInspectPrivateSegment).toHaveBeenCalledWith(segment.storageKey);
  });

  it('builds private storage keys under the configured container', async () => {
    const { createPrivateStorageKey } = await loadStorage();
    const key = createPrivateStorageKey({
      bookingId: 'b1',
      sessionId: 's1',
      sequenceNumber: 3,
      segmentId: 'seg1',
      mimeType: 'video/quicktime',
    });
    expect(key).toBe('ride-recordings/b1/s1/3-seg1.mov');
  });
});

describe('retry behavior', () => {
  const driverId = '22222222-2222-4222-8222-222222222222';
  const sessionId = '55555555-5555-4555-8555-555555555555';

  it('marks segment failed, increments retry, and returns a fresh upload URL', async () => {
    const { failRideVideoSegment } = await loadService();
    const failed = makeSegment({
      uploadStatus: 'failed',
      retryCount: 1,
      failureReason: 'network timeout',
    });
    enqueueSelect([makeSession()]);
    enqueueUpdate([failed]);

    const result = await failRideVideoSegment(sessionId, failed.id as string, driverId, 'network timeout');

    expect(result.segment.uploadStatus).toBe('failed');
    expect(result.segment.retryCount).toBe(1);
    expect(result.segment.failureReason).toBe('network timeout');
    expect(result.upload.url).toContain(`segments/${failed.id}/upload?token=`);
    expect(result.upload.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  });

  it('lists pending/failed segments with retryUpload helpers', async () => {
    const { listRideVideoSegments } = await loadService();
    enqueueSelect([makeSession()]);
    enqueueSelect([
      makeSegment({ uploadStatus: 'failed', retryCount: 2 }),
      makeSegment({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        sequenceNumber: 1,
        uploadStatus: 'verified',
        retryCount: 0,
      }),
    ]);

    const rows = await listRideVideoSegments(sessionId, driverId);
    expect(rows[0].retryUpload).toMatchObject({ method: 'PUT' });
    expect(rows[1].retryUpload).toBeNull();
  });
});

describe('recovery next sequence', () => {
  const driverId = '22222222-2222-4222-8222-222222222222';
  const bookingId = '11111111-1111-4111-8111-111111111111';

  it('reports nextExpectedSequenceNumber as maxSequence + 1', async () => {
    const { getRideVideoSessionStatus } = await loadService();
    mockFindBookingById.mockResolvedValue(makeBooking());
    enqueueSelect([makeSession()]);
    enqueueSelect([
      makeSegment({ sequenceNumber: 0, uploadStatus: 'verified' }),
      makeSegment({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        sequenceNumber: 2,
        uploadStatus: 'failed',
      }),
    ]);

    const status = await getRideVideoSessionStatus(bookingId, driverId);

    expect(status.nextExpectedSequenceNumber).toBe(3);
    expect(status.uploadedSegmentCount).toBe(1);
    expect(status.pendingOrFailedSegmentCount).toBe(1);
    expect(status.shouldContinueRecording).toBe(true);
    expect(status.session?.startedAt).toBe('2026-07-30T12:00:00.000Z');
  });

  it('starts at sequence 0 when no session exists yet', async () => {
    const { getRideVideoSessionStatus } = await loadService();
    mockFindBookingById.mockResolvedValue(makeBooking());
    enqueueSelect([]);

    const status = await getRideVideoSessionStatus(bookingId, driverId);
    expect(status.session).toBeNull();
    expect(status.nextExpectedSequenceNumber).toBe(0);
    expect(status.shouldContinueRecording).toBe(true);
  });
});

describe('pause and resume', () => {
  const driverId = '22222222-2222-4222-8222-222222222222';
  const sessionId = '55555555-5555-4555-8555-555555555555';

  it('pauses an active session idempotently', async () => {
    const { pauseRideVideoSession } = await loadService();
    const paused = makeSession({
      status: 'paused',
      pausedAt: new Date('2026-07-30T12:30:00.000Z'),
    });
    enqueueSelect([makeSession({ status: 'active' })]);
    enqueueUpdate([paused]);

    const result = await pauseRideVideoSession(sessionId, driverId);
    expect(result.status).toBe('paused');
    expect(result.pausedAt).toBe('2026-07-30T12:30:00.000Z');
    expect(mockEmitToAdmins).toHaveBeenCalledWith(
      'recording:session_paused',
      expect.objectContaining({ sessionId })
    );

    enqueueSelect([paused]);
    const again = await pauseRideVideoSession(sessionId, driverId);
    expect(again.status).toBe('paused');
    expect(mockDb.update).toHaveBeenCalledTimes(1);
  });

  it('resumes a paused session after re-checking consent/ownership', async () => {
    const { resumeRideVideoSession } = await loadService();
    mockFindBookingById.mockResolvedValue(makeBooking());
    const resumed = makeSession({ status: 'active', pausedAt: null });
    enqueueSelect([makeSession({ status: 'paused' })]);
    enqueueUpdate([resumed]);

    const result = await resumeRideVideoSession(sessionId, driverId);
    expect(result.status).toBe('active');
    expect(result.pausedAt).toBeNull();
    expect(mockFindBookingById).toHaveBeenCalled();
  });

  it('rejects resume when booking is no longer recordable', async () => {
    const { resumeRideVideoSession } = await loadService();
    mockFindBookingById.mockResolvedValue(makeBooking({ status: BookingStatus.COMPLETED }));
    enqueueSelect([makeSession({ status: 'paused' })]);

    await expect(resumeRideVideoSession(sessionId, driverId)).rejects.toMatchObject({
      code: 'BOOKING_NOT_RECORDABLE',
      statusCode: 409,
    });
  });
});

describe('terminal booking behavior', () => {
  const driverId = '22222222-2222-4222-8222-222222222222';
  const bookingId = '11111111-1111-4111-8111-111111111111';
  const sessionId = '55555555-5555-4555-8555-555555555555';

  it('blocks new sessions on completed/cancelled bookings', async () => {
    const { createOrRestoreRideVideoSession } = await loadService();
    mockFindBookingById.mockResolvedValue(makeBooking({ status: BookingStatus.COMPLETED }));

    await expect(createOrRestoreRideVideoSession(bookingId, driverId)).rejects.toMatchObject({
      code: 'BOOKING_NOT_RECORDABLE',
    });

    mockFindBookingById.mockResolvedValue(makeBooking({ status: BookingStatus.CANCELLED }));
    await expect(createOrRestoreRideVideoSession(bookingId, driverId)).rejects.toMatchObject({
      code: 'BOOKING_NOT_RECORDABLE',
    });
  });

  it('finalizes owned session as completed for finished rides', async () => {
    const { finalizeRideVideoSession } = await loadService();
    mockFindBookingById.mockResolvedValue(makeBooking({ status: BookingStatus.COMPLETED }));
    const active = makeSession({ status: 'active' });
    const finalized = makeSession({
      status: 'completed',
      endedAt: new Date('2026-07-30T13:00:00.000Z'),
      finalizedAt: new Date('2026-07-30T13:00:00.000Z'),
    });
    enqueueSelect([active]); // getOwnedSession
    // finalizeSessionRecord transaction updates (no returning used inside tx)
    enqueueUpdate([]);
    enqueueUpdate([]);
    enqueueUpdate([]);
    enqueueSelect([finalized]); // reload

    const result = await finalizeRideVideoSession(sessionId, driverId);
    expect(result.status).toBe('completed');
    expect(result.finalizedAt).toBe('2026-07-30T13:00:00.000Z');
    expect(result.endedAt).toBe('2026-07-30T13:00:00.000Z');
    expect(mockEmitToDriver).toHaveBeenCalledWith(
      driverId,
      'recording:session_finalized',
      expect.objectContaining({ status: 'completed' })
    );
  });

  it('finalizes booking sessions as cancelled when booking cancelled', async () => {
    const { finalizeRideVideoSessionsForBooking } = await loadService();
    mockFindBookingById.mockResolvedValue(makeBooking({ status: BookingStatus.CANCELLED }));
    const active = makeSession({ status: 'active' });
    const cancelled = makeSession({
      status: 'cancelled',
      endedAt: new Date('2026-07-30T13:05:00.000Z'),
      finalizedAt: new Date('2026-07-30T13:05:00.000Z'),
    });
    enqueueSelect([active]);
    enqueueUpdate([]);
    enqueueUpdate([]);
    enqueueUpdate([]);
    enqueueSelect([cancelled]);

    await finalizeRideVideoSessionsForBooking(bookingId, 'Booking cancelled by driver');
    expect(mockEmitToAdmins).toHaveBeenCalledWith(
      'recording:session_finalized',
      expect.objectContaining({ status: 'cancelled' })
    );
  });

  it('stops shouldContinueRecording after terminal booking', async () => {
    const { getRideVideoSessionStatus } = await loadService();
    mockFindBookingById.mockResolvedValue(makeBooking({ status: BookingStatus.COMPLETED }));
    enqueueSelect([makeSession({ status: 'active' })]);
    enqueueSelect([]);

    const status = await getRideVideoSessionStatus(bookingId, driverId);
    expect(status.shouldContinueRecording).toBe(false);
    expect(status.bookingStatus).toBe(BookingStatus.COMPLETED);
  });
});

describe('ISO timestamps', () => {
  it('formats session and segment timestamps as ISO-8601 strings', async () => {
    const { createOrRestoreRideVideoSession, registerRideVideoSegment } = await loadService();
    const session = makeSession({
      startedAt: new Date('2026-07-30T08:15:30.123Z'),
      pausedAt: new Date('2026-07-30T08:20:00.000Z'),
      status: 'paused',
    });
    mockFindBookingById.mockResolvedValue(makeBooking());
    enqueueSelect([session]);

    const formatted = await createOrRestoreRideVideoSession(
      session.bookingId as string,
      session.driverId as string
    );
    expect(formatted.startedAt).toBe('2026-07-30T08:15:30.123Z');
    expect(formatted.pausedAt).toBe('2026-07-30T08:20:00.000Z');

    const segment = makeSegment({
      recordedAt: new Date('2026-07-30T08:16:00.000Z'),
      createdAt: new Date('2026-07-30T08:16:01.000Z'),
      updatedAt: new Date('2026-07-30T08:16:02.000Z'),
    });
    enqueueSelect([makeSession()]);
    enqueueSelect([segment]);

    const registered = await registerRideVideoSegment(session.id as string, session.driverId as string, {
      clientSegmentId: segment.clientSegmentId as string,
      sequenceNumber: 0,
      mimeType: 'video/mp4',
    });
    expect(registered.segment.recordedAt).toBe('2026-07-30T08:16:00.000Z');
    expect(registered.segment.createdAt).toBe('2026-07-30T08:16:01.000Z');
    expect(registered.upload.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
  });

  it('requires offset-aware ISO recordedAt in register validator', () => {
    const {
      registerVideoSegmentSchema,
    } = require('../src/validators') as typeof import('../src/validators');

    expect(
      registerVideoSegmentSchema.safeParse({
        clientSegmentId: '77777777-7777-4777-8777-777777777777',
        sequenceNumber: 0,
        mimeType: 'video/mp4',
        recordedAt: '2026-07-30T12:00:00.000Z',
      }).success
    ).toBe(true);

    expect(
      registerVideoSegmentSchema.safeParse({
        clientSegmentId: '77777777-7777-4777-8777-777777777777',
        sequenceNumber: 0,
        mimeType: 'video/mp4',
        recordedAt: '2026-07-30 12:00:00',
      }).success
    ).toBe(false);
  });
});

describe('admin route authorization contracts', () => {
  it('protects metadata and read-url with requireAdmin; content uses signed token only', () => {
    const adminBookingSource = fs.readFileSync(
      path.join(__dirname, '../src/routes/v1/admin/booking.ts'),
      'utf8'
    );

    const metadataBlock = adminBookingSource.slice(
      adminBookingSource.indexOf("'/bookings/:bookingId/video'"),
      adminBookingSource.indexOf("'/video/segments/:segmentId/read-url'")
    );
    expect(metadataBlock).toContain('requireAuth');
    expect(metadataBlock).toContain('requireAdmin');
    expect(metadataBlock).toContain('adminBookingVideoHandler');

    const readUrlBlock = adminBookingSource.slice(
      adminBookingSource.indexOf("'/video/segments/:segmentId/read-url'"),
      adminBookingSource.indexOf("'/video/segments/:segmentId/content'")
    );
    expect(readUrlBlock).toContain('requireAuth');
    expect(readUrlBlock).toContain('requireAdmin');
    expect(readUrlBlock).toContain('adminVideoReadUrlHandler');

    expect(adminBookingSource).toContain(
      'The short-lived signed token is the authorization for media bytes'
    );
    const contentBlock = adminBookingSource.slice(
      adminBookingSource.indexOf("'/video/segments/:segmentId/content'"),
      adminBookingSource.indexOf("'/service-categories'")
    );
    expect(contentBlock).toContain('adminVideoContentHandler');
    expect(contentBlock).toContain('validate(videoSegmentIdParamSchema');
    expect(contentBlock).not.toContain('requireAdmin');
    expect(contentBlock).not.toContain('requireAuth');
  });

  it('guards driver video routes with requireDriver auth stack', () => {
    const driverVideoSource = fs.readFileSync(
      path.join(__dirname, '../src/routes/v1/driver/video.ts'),
      'utf8'
    );
    expect(driverVideoSource).toContain('requireAuth');
    expect(driverVideoSource).toContain('requireDriver');
    expect(driverVideoSource).toContain("'/sessions/:sessionId/segments'");
    expect(driverVideoSource).toContain("'/segments/:segmentId/upload'");

    const driverBookingSource = fs.readFileSync(
      path.join(__dirname, '../src/routes/v1/driver/bookings.ts'),
      'utf8'
    );
    expect(driverBookingSource).toContain("'/\:bookingId/video/session'");
    expect(driverBookingSource).toContain('createVideoSessionHandler');
    expect(driverBookingSource).toContain('getVideoSessionStatusHandler');
  });

  it('admin metadata handler does not invent ownership bypass in service layer', async () => {
    const { getAdminRideVideoMetadata } = await loadService();
    mockFindBookingById.mockResolvedValue(makeBooking());
    enqueueSelect([makeSession()]);
    enqueueSelect([makeSegment({ uploadStatus: 'verified' })]);

    const meta = await getAdminRideVideoMetadata('11111111-1111-4111-8111-111111111111');
    expect(meta.booking.id).toBe('11111111-1111-4111-8111-111111111111');
    expect(meta.sessions[0].uploadedCount).toBe(1);
    expect(meta.consentStatus).toBe('granted');
  });
});

describe('schema and migration constraints', () => {
  it('defines recoverable-session uniqueness and status checks in drizzle schema', () => {
    const sessionsSource = fs.readFileSync(
      path.join(__dirname, '../src/db/schema/video_sessions.ts'),
      'utf8'
    );
    expect(sessionsSource).toContain('uq_video_sessions_booking_driver_recoverable');
    expect(sessionsSource).toContain("'pending', 'active', 'paused', 'finalizing'");
    expect(sessionsSource).toContain('video_sessions_status_check');
    expect(sessionsSource).toContain('video_sessions_consent_status_check');
    expect(sessionsSource).toContain('withTimezone: true');

    const segmentsSource = fs.readFileSync(
      path.join(__dirname, '../src/db/schema/video_segments.ts'),
      'utf8'
    );
    expect(segmentsSource).toContain('uq_video_segments_session_sequence');
    expect(segmentsSource).toContain('uq_video_segments_session_client_id');
    expect(segmentsSource).toContain('video_segments_upload_status_check');
    expect(segmentsSource).toContain('video_segments_sequence_check');
    expect(segmentsSource).toContain('onDelete: \'cascade\'');
  });

  it('migration enforces booking/driver restrict FKs, checks, and unique indexes', () => {
    const migration = fs.readFileSync(
      path.join(__dirname, '../src/db/migrations/0020_ride_video_recording_foundation.sql'),
      'utf8'
    );

    expect(migration).toContain('recording_consent_status');
    expect(migration).toContain('uq_video_sessions_booking_driver_recoverable');
    expect(migration).toContain("WHERE \"status\" IN ('pending', 'active', 'paused', 'finalizing')");
    expect(migration).toContain('video_sessions_status_check');
    expect(migration).toContain('video_sessions_consent_status_check');
    expect(migration).toContain('uq_video_segments_session_sequence');
    expect(migration).toContain('uq_video_segments_session_client_id');
    expect(migration).toContain('ON DELETE RESTRICT');
    expect(migration).toContain('video_segments_upload_status_check');
    expect(migration).toContain('CHECK ("segment_index" >= 0)');
    expect(migration).toContain('Superseded during recording migration');
    expect(migration).toContain('ALTER COLUMN "started_at" TYPE timestamptz');
    expect(migration).toContain('ALTER COLUMN "created_at" TYPE timestamptz');
  });

  it('keeps booking consent columns on the bookings schema', () => {
    const bookingsSource = fs.readFileSync(
      path.join(__dirname, '../src/db/schema/bookings.ts'),
      'utf8'
    );
    expect(bookingsSource).toContain('recordingConsentStatus');
    expect(bookingsSource).toContain('recording_consent_status');
    expect(bookingsSource).toContain('recordingConsentRevokedAt');
  });
});

describe('recording disabled flag', () => {
  it('returns 503 when VIDEO_RECORDING_ENABLED is off', async () => {
    videoConfigState.enabled = false;
    const { createOrRestoreRideVideoSession } = await loadService();

    await expect(
      createOrRestoreRideVideoSession(
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222'
      )
    ).rejects.toMatchObject({
      code: 'VIDEO_RECORDING_DISABLED',
      statusCode: 503,
    });
  });
});
