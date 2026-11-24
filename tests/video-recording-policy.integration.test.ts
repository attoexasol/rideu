/**
 * Effective recording policy (VIDEO_RECORDING_ENABLED && Admin setting) applied to
 * ride start consent, driver booking video metadata, and recording:session_available.
 */
import { BookingStatus } from '../src/constants/bookingStatus';
import { BillingMode } from '../src/services/softMeter/billingMode';

const videoConfigState = {
  enabled: false,
  consentRequired: true,
  segmentDurationSeconds: 10,
};

const policyState: { enabled: boolean; fail: boolean; missing: boolean } = {
  enabled: false,
  fail: false,
  missing: false,
};

const mockFindPlatformSettings = jest.fn(async () => {
  if (policyState.fail) throw new Error('connection refused');
  if (policyState.missing) return null;
  return {
    id: 1,
    videoRecordingEnabled: policyState.enabled,
    version: 3,
    updatedByAdminUserId: null,
    updatedByAuth0Id: null,
    updatedByEmail: null,
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    updatedAt: new Date('2026-07-30T00:00:00.000Z'),
  };
});

const mockFindBookingById = jest.fn();
const mockUpdateBooking = jest.fn();
const mockInsertBookingEvent = jest.fn().mockResolvedValue(undefined);
const mockGetBookingDetail = jest.fn();
const mockFindActiveBookingByDriver = jest.fn();
const mockEmitBookingStatus = jest.fn().mockResolvedValue(undefined);
const mockLinkSessionToTrip = jest.fn().mockResolvedValue(undefined);
const mockEmitRideVideoAvailable = jest.fn().mockResolvedValue([]);
const mockFindActiveSessionByBooking = jest.fn();
const mockListLiveSegments = jest.fn();
const mockNotifyPassenger = jest.fn();

function chain(result: unknown) {
  const c: Record<string, unknown> = {};
  const self = () => c;
  c.from = jest.fn(self);
  c.where = jest.fn(self);
  c.limit = jest.fn(async () => result);
  c.values = jest.fn(self);
  c.set = jest.fn(self);
  c.returning = jest.fn(async () => result);
  c.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(ok, bad);
  return c;
}

jest.mock('../src/config/video', () => ({ videoConfig: videoConfigState }));

jest.mock('../src/db/connection', () => ({
  db: {
    select: jest.fn(() => chain([])),
    insert: jest.fn(() => chain([{ id: 'trip-1' }])),
    update: jest.fn(() => chain([])),
  },
}));

jest.mock('../src/db/utils', () => ({ adminUtils: { findByAuth0Id: jest.fn() } }));

jest.mock('../src/config/redis', () => ({
  realtimeCache: { setDriverStatus: jest.fn() },
}));

jest.mock('../src/middleware/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../src/repositories/platformSettings.repository', () => ({
  findPlatformSettings: () => mockFindPlatformSettings(),
  setVideoRecordingEnabledWithAudit: jest.fn(),
  listRecordingPolicyAuditEvents: jest.fn(),
}));

jest.mock('../src/repositories/booking.repository', () => ({
  findBookingById: (...a: unknown[]) => mockFindBookingById(...a),
  updateBooking: (...a: unknown[]) => mockUpdateBooking(...a),
  insertBookingEvent: (...a: unknown[]) => mockInsertBookingEvent(...a),
  getBookingDetail: (...a: unknown[]) => mockGetBookingDetail(...a),
  findActiveBookingByDriver: (...a: unknown[]) => mockFindActiveBookingByDriver(...a),
  findPendingOfferForDriver: jest.fn(),
  findActiveBookingByCustomer: jest.fn(),
  listBookingsByCustomer: jest.fn(),
  countCustomerBookings: jest.fn(),
  findIdempotencyRecord: jest.fn(),
  createPendingBookingOffer: jest.fn(),
  listExcludedDriverIdsForBooking: jest.fn(),
  findOfferById: jest.fn(),
  cancelPendingOffersForBooking: jest.fn(),
}));

jest.mock('../src/repositories/serviceCategory.repository', () => ({
  findPaymentMethodByCode: jest.fn(),
  findServiceCategoryById: jest.fn(),
}));
jest.mock('../src/repositories/bookingPayment.repository', () => ({
  findBookingPaymentByBookingId: jest.fn(async () => null),
}));
jest.mock('../src/repositories/meterSession.repository', () => ({
  findMeterByBooking: jest.fn(async () => null),
}));

jest.mock('../src/services/payment.service', () => ({
  assertCardPaymentAllowed: jest.fn(),
  captureAuthorizedBookingPayment: jest.fn(),
  prepareCardPaymentForBooking: jest.fn(),
  recordCompletedCashBookingPayment: jest.fn(),
  releaseCardPaymentAuthorization: jest.fn(),
}));
jest.mock('../src/services/fare.service', () => ({ quoteSingleCategory: jest.fn() }));

jest.mock('../src/services/bookingNotify.service', () => ({
  emitBookingStatus: (...a: unknown[]) => mockEmitBookingStatus(...a),
  emitRecordingConsent: jest.fn(),
  emitOfferCancelled: jest.fn(),
  emitToAdmins: jest.fn(),
  emitToCustomer: jest.fn(),
  emitToDriver: jest.fn(),
  emitToAllDrivers: jest.fn(),
}));

jest.mock('../src/services/driverAvailability.service', () => ({
  releaseDriverAvailability: jest.fn(),
  checkDriverEligibility: jest.fn(),
  resolveDispatchVehicle: jest.fn(),
}));
jest.mock('../src/services/vehicleExchange.service', () => ({ hasPendingExchange: jest.fn() }));
jest.mock('../src/services/driverAcceptanceLock.service', () => ({
  setDriverAcceptingOffer: jest.fn(),
  clearDriverAcceptingOffer: jest.fn(),
  isDriverAcceptingOffer: jest.fn(),
}));
jest.mock('../src/services/driverOfferNotify.service', () => ({
  notifyDriverOfPersistedOffer: jest.fn(),
}));
jest.mock('../src/services/passengerRideNotify.service', () => ({
  notifyPassengerOfRideEvent: (...a: unknown[]) => mockNotifyPassenger(...a),
}));
jest.mock('../src/services/dispatch.service', () => ({
  startDispatch: jest.fn(),
  clearDispatchTimer: jest.fn(),
}));

jest.mock('../src/services/rideVideo.service', () => ({
  linkSessionToTrip: (...a: unknown[]) => mockLinkSessionToTrip(...a),
  finalizeRideVideoSessionsForBooking: jest.fn(),
  emitRideVideoAvailable: (...a: unknown[]) => mockEmitRideVideoAvailable(...a),
}));

jest.mock('../src/services/liveVideo.service', () => ({
  findActiveSessionByBooking: (...a: unknown[]) => mockFindActiveSessionByBooking(...a),
  listLiveSegments: (...a: unknown[]) => mockListLiveSegments(...a),
}));

jest.mock('../src/services/bookingRoute.service', () => ({
  resolveBookingRoute: jest.fn(async () => null),
}));

type Combo = { server: boolean; admin: boolean; effective: boolean; label: string };
const COMBOS: Combo[] = [
  { label: 'server OFF + admin OFF', server: false, admin: false, effective: false },
  { label: 'server ON + admin OFF', server: true, admin: false, effective: false },
  { label: 'server ON + admin ON', server: true, admin: true, effective: true },
  { label: 'server OFF + admin ON', server: false, admin: true, effective: false },
];

function setPolicy(server: boolean, admin: boolean) {
  videoConfigState.enabled = server;
  policyState.enabled = admin;
}

const bookingId = 'booking-1';
const driverId = 'driver-1';

function arrivedBooking(consent: { status: string | null; at: Date | null }) {
  return {
    id: bookingId,
    customerId: 'cust-1',
    assignedDriverId: driverId,
    status: BookingStatus.ARRIVED,
    billingMode: BillingMode.QUOTED_PREPAY,
    recordingConsentStatus: consent.status,
    recordingConsentedAt: consent.at,
  };
}

function bookingDetail(status: string) {
  return {
    booking: {
      id: bookingId,
      customerId: 'cust-1',
      bookingNumber: 'BK1',
      status,
      recordingConsentedAt: null,
      pickupLatitude: '23.81',
      pickupLongitude: '90.41',
      pickupAddress: 'A',
      pickupSpotLabel: null,
      dropoffLatitude: '23.75',
      dropoffLongitude: '90.38',
      dropoffAddress: 'B',
      finalFare: '120.00',
      assignedVehicleId: null,
      serviceCategoryId: 'cat-1',
      routeEncodedPolyline: null,
      estimatedDistanceKm: null,
      estimatedDurationMin: null,
    },
    customerName: 'Rider',
    serviceCode: 'ride',
    serviceName: 'Ride',
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  setPolicy(false, false);
  policyState.fail = false;
  policyState.missing = false;
  mockUpdateBooking.mockImplementation(async (_id: string, patch: Record<string, unknown>) => ({
    id: bookingId,
    ...patch,
  }));
  mockFindActiveSessionByBooking.mockResolvedValue(null);
  mockListLiveSegments.mockResolvedValue([]);
  mockFindActiveBookingByDriver.mockResolvedValue({ id: bookingId });
  mockEmitRideVideoAvailable.mockResolvedValue([]);
});

describe('ride start consent gate (booking.service)', () => {
  const noConsent = { status: 'pending', at: null };

  it.each(COMBOS)('$label: consent enforced only when effective', async (combo) => {
    setPolicy(combo.server, combo.admin);
    mockFindBookingById.mockResolvedValue(arrivedBooking(noConsent));
    const { updateBookingStatusByDriver } = await import('../src/services/booking.service');

    if (combo.effective) {
      await expect(
        updateBookingStatusByDriver(bookingId, driverId, BookingStatus.IN_PROGRESS)
      ).rejects.toMatchObject({ code: 'RECORDING_CONSENT_REQUIRED' });
      expect(mockUpdateBooking).not.toHaveBeenCalled();
    } else {
      const result = (await updateBookingStatusByDriver(
        bookingId,
        driverId,
        BookingStatus.IN_PROGRESS
      )) as { status: string; video: { required: boolean } };
      expect(result.status).toBe(BookingStatus.IN_PROGRESS);
      expect(result.video.required).toBe(false);
      expect(mockLinkSessionToTrip).toHaveBeenCalledWith(bookingId, 'trip-1');
      expect(mockEmitBookingStatus).toHaveBeenCalled();
    }
  });

  it('server ON + admin ON: denied consent still blocks the ride', async () => {
    setPolicy(true, true);
    mockFindBookingById.mockResolvedValue(arrivedBooking({ status: 'denied', at: null }));
    const { updateBookingStatusByDriver } = await import('../src/services/booking.service');
    await expect(
      updateBookingStatusByDriver(bookingId, driverId, BookingStatus.IN_PROGRESS)
    ).rejects.toMatchObject({ code: 'RECORDING_CONSENT_REQUIRED' });
  });

  it('server ON + admin ON: granted consent starts the ride with video.required=true', async () => {
    setPolicy(true, true);
    mockFindBookingById.mockResolvedValue(
      arrivedBooking({ status: 'granted', at: new Date('2026-08-01T10:00:00Z') })
    );
    mockFindActiveSessionByBooking.mockResolvedValue({ id: 'sess-1' });
    const { updateBookingStatusByDriver } = await import('../src/services/booking.service');
    const result = (await updateBookingStatusByDriver(
      bookingId,
      driverId,
      BookingStatus.IN_PROGRESS
    )) as { video: { required: boolean; sessionId: string | null } };
    expect(result.video).toMatchObject({ required: true, sessionId: 'sess-1' });
  });

  it('server ON + admin ON but consent not required: no consent block', async () => {
    setPolicy(true, true);
    videoConfigState.consentRequired = false;
    try {
      mockFindBookingById.mockResolvedValue(arrivedBooking(noConsent));
      const { updateBookingStatusByDriver } = await import('../src/services/booking.service');
      const result = (await updateBookingStatusByDriver(
        bookingId,
        driverId,
        BookingStatus.IN_PROGRESS
      )) as { video: { required: boolean } };
      expect(result.video.required).toBe(true);
    } finally {
      videoConfigState.consentRequired = true;
    }
  });

  it.each([
    ['DB read fails', { fail: true, missing: false }],
    ['settings row missing', { fail: false, missing: true }],
  ])('%s: recording OFF, ride still starts', async (_label, state) => {
    setPolicy(true, true);
    Object.assign(policyState, state);
    mockFindBookingById.mockResolvedValue(arrivedBooking(noConsent));
    const { updateBookingStatusByDriver } = await import('../src/services/booking.service');
    const result = (await updateBookingStatusByDriver(
      bookingId,
      driverId,
      BookingStatus.IN_PROGRESS
    )) as { status: string; video: { required: boolean } };
    expect(result.status).toBe(BookingStatus.IN_PROGRESS);
    expect(result.video.required).toBe(false);
  });

  it('server OFF never reads the policy table on ride start', async () => {
    setPolicy(false, true);
    mockFindBookingById.mockResolvedValue(arrivedBooking(noConsent));
    const { updateBookingStatusByDriver } = await import('../src/services/booking.service');
    await updateBookingStatusByDriver(bookingId, driverId, BookingStatus.IN_PROGRESS);
    expect(mockFindPlatformSettings).not.toHaveBeenCalled();
  });

  it('non-start transitions do not read the policy', async () => {
    setPolicy(true, true);
    mockFindBookingById.mockResolvedValue({
      ...arrivedBooking(noConsent),
      status: BookingStatus.DRIVER_EN_ROUTE,
    });
    const { updateBookingStatusByDriver } = await import('../src/services/booking.service');
    const result = (await updateBookingStatusByDriver(
      bookingId,
      driverId,
      BookingStatus.ARRIVED
    )) as Record<string, unknown>;
    expect(result.status).toBe(BookingStatus.ARRIVED);
    expect(result).not.toHaveProperty('video');
    expect(mockFindPlatformSettings).not.toHaveBeenCalled();
  });
});

describe('driver booking video metadata (driverBooking.service)', () => {
  it.each(COMBOS)('$label: video.required mirrors effective policy', async (combo) => {
    setPolicy(combo.server, combo.admin);
    mockGetBookingDetail.mockResolvedValue(bookingDetail(BookingStatus.IN_PROGRESS));
    mockFindActiveSessionByBooking.mockResolvedValue({ id: 'sess-1', status: 'active' });
    mockListLiveSegments.mockResolvedValue([{ sequenceNumber: 0 }, { sequenceNumber: 1 }]);
    const { getDriverActiveBookingResponse } = await import(
      '../src/services/driverBooking.service'
    );
    const result = (await getDriverActiveBookingResponse(driverId)) as {
      video: { required: boolean; active: boolean; sessionId: string; nextSegmentIndex: number };
    };
    expect(result.video).toMatchObject({
      required: combo.effective,
      active: combo.effective,
      sessionId: 'sess-1',
      nextSegmentIndex: 2,
    });
  });

  it('DB setting unavailable: required=false and payload still returned', async () => {
    setPolicy(true, true);
    policyState.fail = true;
    mockGetBookingDetail.mockResolvedValue(bookingDetail(BookingStatus.IN_PROGRESS));
    const { getDriverActiveBookingResponse } = await import(
      '../src/services/driverBooking.service'
    );
    const result = (await getDriverActiveBookingResponse(driverId)) as {
      booking: { id: string };
      video: { required: boolean; active: boolean };
    };
    expect(result.booking.id).toBe(bookingId);
    expect(result.video).toMatchObject({ required: false, active: false });
  });

  it('Admin switches OFF during an active ride: next payload stops requiring recording', async () => {
    setPolicy(true, true);
    mockGetBookingDetail.mockResolvedValue(bookingDetail(BookingStatus.IN_PROGRESS));
    mockFindActiveSessionByBooking.mockResolvedValue({ id: 'sess-1', status: 'active' });
    const { getDriverActiveBookingResponse } = await import(
      '../src/services/driverBooking.service'
    );
    const before = (await getDriverActiveBookingResponse(driverId)) as {
      video: { required: boolean; active: boolean };
    };
    expect(before.video).toMatchObject({ required: true, active: true });

    policyState.enabled = false;
    const after = (await getDriverActiveBookingResponse(driverId)) as {
      booking: { status: string };
      video: { required: boolean; active: boolean; sessionId: string };
    };
    expect(after.booking.status).toBe(BookingStatus.IN_PROGRESS);
    expect(after.video).toMatchObject({ required: false, active: false, sessionId: 'sess-1' });
  });
});

describe('recording:session_available on accept (dispatch.service)', () => {
  const params = { bookingId, driverId, passengerId: 'cust-1' };

  function loadDispatch() {
    return jest.requireActual<typeof import('../src/services/dispatch.service')>(
      '../src/services/dispatch.service'
    );
  }

  it.each(COMBOS)('$label: emitted only when effective', async (combo) => {
    setPolicy(combo.server, combo.admin);
    const emitted = await loadDispatch().emitRecordingSessionAvailableIfPermitted(params);
    expect(emitted).toBe(combo.effective);
    if (combo.effective) {
      expect(mockEmitRideVideoAvailable).toHaveBeenCalledWith(params);
    } else {
      expect(mockEmitRideVideoAvailable).not.toHaveBeenCalled();
    }
  });

  it('DB setting unavailable: not emitted', async () => {
    setPolicy(true, true);
    policyState.fail = true;
    expect(await loadDispatch().emitRecordingSessionAvailableIfPermitted(params)).toBe(false);
    expect(mockEmitRideVideoAvailable).not.toHaveBeenCalled();
  });

  it('Admin switches OFF between rides: next accept is not advertised', async () => {
    setPolicy(true, true);
    const { emitRecordingSessionAvailableIfPermitted } = loadDispatch();
    expect(await emitRecordingSessionAvailableIfPermitted(params)).toBe(true);
    policyState.enabled = false;
    expect(await emitRecordingSessionAvailableIfPermitted(params)).toBe(false);
    expect(mockEmitRideVideoAvailable).toHaveBeenCalledTimes(1);
  });

  it('emit failure is swallowed so acceptance is not affected', async () => {
    setPolicy(true, true);
    mockEmitRideVideoAvailable.mockRejectedValueOnce(new Error('socket down'));
    await expect(
      loadDispatch().emitRecordingSessionAvailableIfPermitted(params)
    ).resolves.toBe(false);
  });
});
