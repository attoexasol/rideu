import {
  buildAndroidOfferFcmMessage,
  buildOfferPushDataPayload,
  classifyFcmError,
  getFcmErrorCode,
  offerPushCollapseKey,
  remainingOfferTtlSeconds,
  shouldSendOfferPush,
} from '../src/services/driverOfferPush.payload';
import { DISPATCH_OFFER_TTL_SECONDS } from '../src/constants/bookingStatus';

describe('offer push payload', () => {
  it('contains only type, offerId, and bookingId as strings', () => {
    const payload = buildOfferPushDataPayload({
      offerId: 'offer-1',
      bookingId: 'booking-1',
    });
    expect(payload).toEqual({
      type: 'booking_offer',
      offerId: 'offer-1',
      bookingId: 'booking-1',
    });
    expect(Object.keys(payload).sort()).toEqual(['bookingId', 'offerId', 'type']);
    expect(JSON.stringify(payload)).not.toMatch(/phone|pickup|dropoff|route|fare|jwt|http/i);
  });

  it('uses a stable collapse key per offerId', () => {
    expect(offerPushCollapseKey('offer-uuid')).toBe('booking_offer:offer-uuid');
  });
});

describe('offer push TTL', () => {
  const now = new Date('2026-08-18T00:00:00.000Z');

  it('is remaining seconds until expiresAt and never larger than offer lifetime', () => {
    const expiresAt = new Date(now.getTime() + 30_000);
    expect(remainingOfferTtlSeconds(expiresAt, now)).toBe(30);
    expect(remainingOfferTtlSeconds(expiresAt, now)).toBeLessThanOrEqual(
      DISPATCH_OFFER_TTL_SECONDS
    );
  });

  it('caps TTL at DISPATCH_OFFER_TTL_SECONDS', () => {
    const expiresAt = new Date(now.getTime() + 10 * 60_000);
    expect(remainingOfferTtlSeconds(expiresAt, now)).toBe(DISPATCH_OFFER_TTL_SECONDS);
  });

  it('returns 0 for expired offers', () => {
    const expiresAt = new Date(now.getTime() - 1);
    expect(remainingOfferTtlSeconds(expiresAt, now)).toBe(0);
    expect(shouldSendOfferPush(expiresAt, now)).toBe(false);
  });

  it('does not send at the exact expiry boundary', () => {
    expect(shouldSendOfferPush(now, now)).toBe(false);
  });

  it('puts Android TTL in milliseconds and keeps data identifiers only', () => {
    const message = buildAndroidOfferFcmMessage({
      token: 'secret-token-should-not-be-asserted-as-payload',
      offerId: 'offer-1',
      bookingId: 'booking-1',
      ttlSeconds: 45,
    });
    expect(message.android.priority).toBe('high');
    expect(message.android.ttl).toBe(45_000);
    expect(message.android.ttl).toBeLessThanOrEqual(DISPATCH_OFFER_TTL_SECONDS * 1000);
    expect(message.android.collapseKey).toBe('booking_offer:offer-1');
    expect(message.data).toEqual({
      type: 'booking_offer',
      offerId: 'offer-1',
      bookingId: 'booking-1',
    });
    expect(message).not.toHaveProperty('notification');
  });
});

describe('FCM error classification', () => {
  it('treats unregistered tokens as permanent', () => {
    expect(
      classifyFcmError({ code: 'messaging/registration-token-not-registered' })
    ).toBe('permanent_token');
    expect(classifyFcmError({ code: 'UNREGISTERED' })).toBe('permanent_token');
    expect(getFcmErrorCode({ code: 'UNREGISTERED' })).toBe('UNREGISTERED');
  });

  it('treats unavailable/timeout as transient', () => {
    expect(classifyFcmError({ code: 'messaging/unavailable' })).toBe('transient');
    expect(classifyFcmError({ code: 'TIMEOUT' })).toBe('transient');
  });
});
