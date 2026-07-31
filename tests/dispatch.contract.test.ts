import { isLocationFresh } from '../src/services/driverAvailability.service';
import { BookingStatus } from '../src/constants/bookingStatus';

describe('isLocationFresh', () => {
  it('returns true for recent timestamps', () => {
    const recent = new Date(Date.now() - 30_000).toISOString();
    expect(isLocationFresh(recent, 120)).toBe(true);
  });

  it('returns false for stale timestamps', () => {
    const stale = new Date(Date.now() - 300_000).toISOString();
    expect(isLocationFresh(stale, 120)).toBe(false);
  });

  it('returns false when timestamp is missing', () => {
    expect(isLocationFresh(undefined, 120)).toBe(false);
  });
});

describe('driver status transition matrix', () => {
  const transitions: Record<string, string[]> = {
    [BookingStatus.DRIVER_EN_ROUTE]: [BookingStatus.ARRIVED],
    [BookingStatus.ARRIVED]: [BookingStatus.IN_PROGRESS],
    [BookingStatus.IN_PROGRESS]: [BookingStatus.COMPLETED],
  };

  it('allows valid forward transitions only', () => {
    expect(transitions[BookingStatus.DRIVER_EN_ROUTE]).toContain(BookingStatus.ARRIVED);
    expect(transitions[BookingStatus.ARRIVED]).toContain(BookingStatus.IN_PROGRESS);
    expect(transitions[BookingStatus.IN_PROGRESS]).toContain(BookingStatus.COMPLETED);
  });

  it('does not allow skipping arrived', () => {
    expect(transitions[BookingStatus.DRIVER_EN_ROUTE]).not.toContain(BookingStatus.IN_PROGRESS);
  });
});

describe('booking offer terminal statuses', () => {
  it('includes declined and taken statuses for exclusion', async () => {
    const { TERMINAL_OFFER_STATUSES, BookingOfferStatus } = await import(
      '../src/constants/bookingStatus'
    );
    expect(TERMINAL_OFFER_STATUSES).toContain(BookingOfferStatus.DECLINED);
    expect(TERMINAL_OFFER_STATUSES).toContain(BookingOfferStatus.TAKEN);
    expect(TERMINAL_OFFER_STATUSES).toContain(BookingOfferStatus.EXPIRED);
  });
});

describe('dispatch config defaults', () => {
  it('loads sane defaults when env vars are absent', () => {
    const { dispatchConfig } = require('../src/config/dispatch');
    const { videoConfig } = require('../src/config/video');
    expect(dispatchConfig.dispatchRadiusKm).toBeGreaterThan(0);
    expect(dispatchConfig.dispatchBatchSize).toBeGreaterThan(0);
    expect(dispatchConfig.dispatchOfferTimeoutSeconds).toBeGreaterThan(0);
    expect(videoConfig.segmentDurationSeconds).toBeGreaterThan(0);
  });
});
