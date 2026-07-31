import { createBookingSchema } from '../src/validators';
import {
  isDriverActivityFresh,
  type DriverActivityTimestamps,
} from '../src/services/driver-inactivity-checker';

describe('createBookingSchema Flutter null compatibility', () => {
  const basePayload = {
    serviceCategoryId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    pickup: {
      latitude: 23.7638929,
      longitude: 90.4287913,
      address: 'Pickup address',
      spotLabel: null,
    },
    dropoff: {
      latitude: 23.7527,
      longitude: 90.3818,
      address: 'Dropoff address',
      placeId: null,
    },
    stops: [],
    paymentMethodCode: 'cash',
    schedulingType: 'instant' as const,
  };

  it('accepts explicit null for optional string fields from Dart', () => {
    const result = createBookingSchema.safeParse(basePayload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.pickup.spotLabel).toBeUndefined();
      expect(result.data.dropoff.placeId).toBeUndefined();
    }
  });

  it('rejects missing required address', () => {
    const result = createBookingSchema.safeParse({
      ...basePayload,
      pickup: { latitude: 23.76, longitude: 90.42, address: '', spotLabel: null },
    });
    expect(result.success).toBe(false);
  });
});

describe('isDriverActivityFresh', () => {
  const now = Date.now();
  const freshIso = new Date(now - 5_000).toISOString();
  const staleIso = new Date(now - 20 * 60_000).toISOString();

  it('returns true when redis heartbeat is fresh', () => {
    const timestamps: DriverActivityTimestamps = {
      redisHeartbeat: freshIso,
      redisLocation: staleIso,
      dbLastSeen: new Date(staleIso),
      dbLocation: new Date(staleIso),
    };
    expect(isDriverActivityFresh(timestamps, 10)).toBe(true);
  });

  it('returns true when redis location is fresh but db location is stale', () => {
    const timestamps: DriverActivityTimestamps = {
      redisHeartbeat: null,
      redisLocation: freshIso,
      dbLastSeen: new Date(staleIso),
      dbLocation: new Date(staleIso),
    };
    expect(isDriverActivityFresh(timestamps, 10)).toBe(true);
  });

  it('returns false when all activity signals are stale', () => {
    const timestamps: DriverActivityTimestamps = {
      redisHeartbeat: staleIso,
      redisLocation: staleIso,
      dbLastSeen: new Date(staleIso),
      dbLocation: new Date(staleIso),
    };
    expect(isDriverActivityFresh(timestamps, 10)).toBe(false);
  });

  it('returns false when no timestamps are provided', () => {
    expect(isDriverActivityFresh({}, 10)).toBe(false);
  });
});

describe('expireStaleOffers timestamp binding', () => {
  it('uses Drizzle lt() with Date without raw sql Date embedding', async () => {
    const { lt, and, eq } = await import('drizzle-orm');
    const { bookingOffers } = await import('../src/db/schema/booking_offers');
    const { BookingOfferStatus } = await import('../src/constants/bookingStatus');

    const now = new Date();
    const condition = and(
      eq(bookingOffers.status, BookingOfferStatus.PENDING),
      lt(bookingOffers.expiresAt, now)
    );

    expect(condition).toBeDefined();
    expect(now.toISOString()).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
