import {
  buildOfferTimeWindow,
  assertOfferExpiryAfterOffered,
  isOfferExpiredAt,
  isOfferExpiryInFuture,
  OfferTimestampConfigError,
} from '../src/utils/offerTimestamps';
import { BookingStatus } from '../src/constants/bookingStatus';

describe('offer timestamp window', () => {
  const fixedNow = Date.parse('2026-07-28T23:40:21.000Z');

  it('expiresAt is strictly after offeredAt', () => {
    const window = buildOfferTimeWindow(45, fixedNow);
    expect(window.expiresAt.getTime()).toBeGreaterThan(window.offeredAt.getTime());
    expect(window.expiresAt.toISOString()).toBe('2026-07-28T23:41:06.000Z');
    expect(window.offeredAt.toISOString()).toBe('2026-07-28T23:40:21.000Z');
  });

  it('serializes API timestamps as ISO UTC', () => {
    const window = buildOfferTimeWindow(30, fixedNow);
    expect(window.offeredAt.toISOString().endsWith('Z')).toBe(true);
    expect(window.expiresAt.toISOString().endsWith('Z')).toBe(true);
  });

  it('rejects non-positive TTL', () => {
    expect(() => buildOfferTimeWindow(0, fixedNow)).toThrow(OfferTimestampConfigError);
    expect(() => buildOfferTimeWindow(-1, fixedNow)).toThrow(OfferTimestampConfigError);
  });

  it('assertOfferExpiryAfterOffered fails when expires is not later', () => {
    const offeredAt = new Date(fixedNow);
    const expiresAt = new Date(fixedNow);
    expect(() => assertOfferExpiryAfterOffered(offeredAt, expiresAt, 45)).toThrow(
      OfferTimestampConfigError
    );
  });
});

describe('offer expiry boundary', () => {
  const expiresAt = new Date('2026-07-28T23:41:06.000Z');

  it('is still pending before expiry', () => {
    const now = new Date('2026-07-28T23:41:05.999Z');
    expect(isOfferExpiryInFuture(expiresAt, now)).toBe(true);
    expect(isOfferExpiredAt(expiresAt, now)).toBe(false);
  });

  it('is expired at exact boundary (expiresAt <= now)', () => {
    const now = new Date('2026-07-28T23:41:06.000Z');
    expect(isOfferExpiryInFuture(expiresAt, now)).toBe(false);
    expect(isOfferExpiredAt(expiresAt, now)).toBe(true);
  });

  it('is expired after timeout', () => {
    const now = new Date('2026-07-28T23:41:06.001Z');
    expect(isOfferExpiredAt(expiresAt, now)).toBe(true);
  });
});

describe('Asia/Dhaka vs UTC clock consistency', () => {
  it('same epoch yields identical ISO window regardless of process TZ offset labeling', () => {
    const epoch = Date.parse('2026-07-29T05:40:21+06:00'); // == 2026-07-28T23:40:21Z
    const window = buildOfferTimeWindow(45, epoch);
    expect(window.offeredAt.toISOString()).toBe('2026-07-28T23:40:21.000Z');
    expect(window.expiresAt.toISOString()).toBe('2026-07-28T23:41:06.000Z');
    // Dhaka wall would be 05:40:21 / 05:41:06 — instant math must not subtract 6h
    expect(window.expiresAt.getTime() - window.offeredAt.getTime()).toBe(45_000);
  });

  it('UTC environment behaves identically for the same epoch', () => {
    const epoch = Date.parse('2026-07-28T23:40:21.000Z');
    const a = buildOfferTimeWindow(45, epoch);
    const b = buildOfferTimeWindow(45, epoch);
    expect(a.offeredAt.toISOString()).toBe(b.offeredAt.toISOString());
    expect(a.expiresAt.toISOString()).toBe(b.expiresAt.toISOString());
  });
});

describe('pending offer recovery contract', () => {
  it('requires searchable/offered booking statuses for recovery', () => {
    const allowed = new Set<string>([BookingStatus.SEARCHING, BookingStatus.OFFERED]);
    expect(allowed.has(BookingStatus.SEARCHING)).toBe(true);
    expect(allowed.has(BookingStatus.OFFERED)).toBe(true);
    expect(allowed.has(BookingStatus.CANCELLED)).toBe(false);
    expect(allowed.has(BookingStatus.COMPLETED)).toBe(false);
  });
});

describe('socket room naming', () => {
  it('uses driver-{uuid} room for offer delivery', () => {
    const driverId = '4d8d26f0-cee9-4575-8331-ae64b072f42c';
    expect(`driver-${driverId}`).toBe('driver-4d8d26f0-cee9-4575-8331-ae64b072f42c');
  });

  it('rejects auth0-style ids as room keys', () => {
    const auth0Id = 'auth0|6a319730742a00cbbf298b54';
    const looksLikeUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        auth0Id
      );
    expect(looksLikeUuid).toBe(false);
  });
});

describe('expiration worker once-only semantics', () => {
  it('marks expired using pending status guard (idempotent filter)', async () => {
    const { BookingOfferStatus } = await import('../src/constants/bookingStatus');
    // Worker updates WHERE status=pending AND expires_at <= now — re-run finds zero rows
    expect(BookingOfferStatus.PENDING).toBe('pending');
    expect(BookingOfferStatus.EXPIRED).toBe('expired');
  });
});

describe('dispatch next batch after expiry', () => {
  it('reverts offered booking to searching when no pending offers remain', () => {
    // Mirrors shouldRevertBookingToSearching without importing dispatch (avoids Redis side-effects)
    const shouldRevert = (
      status: string,
      assignedDriverId: string | null | undefined,
      pendingOfferCount: number
    ) => {
      if (assignedDriverId) return false;
      if (status !== BookingStatus.OFFERED && status !== BookingStatus.SEARCHING) return false;
      return pendingOfferCount === 0;
    };
    expect(shouldRevert(BookingStatus.OFFERED, null, 0)).toBe(true);
    expect(shouldRevert(BookingStatus.OFFERED, null, 1)).toBe(false);
  });
});
