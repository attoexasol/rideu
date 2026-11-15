import {
  buildAndroidOfferFcmMessage,
  buildDriverOfferFcmMessage,
  buildOfferPushDataPayload,
  classifyFcmError,
  fcmTokenSuffix,
  getFcmErrorCode,
  offerPushCollapseKey,
  offerPushNotificationCopy,
  remainingOfferTtlSeconds,
  shouldSendOfferPush,
} from '../src/services/driverOfferPush.payload';
import { DISPATCH_OFFER_TTL_SECONDS } from '../src/constants/bookingStatus';

const PRIVATE_DETAIL = /phone|pickup|dropoff|route|fare|jwt|https?:|passenger|address/i;

describe('offer push payload', () => {
  it('contains type and offerId, and bookingId when present', () => {
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
    expect(JSON.stringify(payload)).not.toMatch(PRIVATE_DETAIL);
  });

  it('omits bookingId when it is absent', () => {
    const payload = buildOfferPushDataPayload({
      offerId: 'offer-1',
    });
    expect(payload).toEqual({
      type: 'booking_offer',
      offerId: 'offer-1',
    });
    expect(payload).not.toHaveProperty('bookingId');
  });

  it('uses a stable collapse key per offerId', () => {
    expect(offerPushCollapseKey('offer-uuid')).toBe('booking_offer:offer-uuid');
  });

  it('exposes only a 4-character token suffix', () => {
    expect(fcmTokenSuffix('abcdefghijklmnopqrstuvwxyzABCD')).toBe('ABCD');
    expect(fcmTokenSuffix('short')).toBe('****');
    expect(fcmTokenSuffix('abcdefghijklmnopqrstuvwxyzABCD')).not.toBe(
      'abcdefghijklmnopqrstuvwxyzABCD'
    );
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
    expect(message.android).not.toHaveProperty('notification');
  });
});

describe('driver offer FCM message for Android + iOS', () => {
  const now = new Date('2026-08-18T00:00:00.000Z');

  it('keeps Android data-only behavior and adds an APNs user-visible alert', () => {
    const message = buildDriverOfferFcmMessage({
      token: 'secret-token-should-not-be-asserted-as-payload',
      offerId: 'offer-1',
      bookingId: 'booking-1',
      ttlSeconds: 45,
      now,
    });

    expect(message.data.type).toBe('booking_offer');
    expect(message.data.offerId).toBe('offer-1');
    expect(message.data.bookingId).toBe('booking-1');
    expect(message.android.priority).toBe('high');
    expect(message.android.ttl).toBe(45_000);
    expect(message.android.collapseKey).toBe('booking_offer:offer-1');
    expect(message).not.toHaveProperty('notification');
    expect(message.android).not.toHaveProperty('notification');

    expect(message.apns.headers['apns-push-type']).toBe('alert');
    expect(message.apns.headers['apns-priority']).toBe('10');
    expect(message.apns.headers['apns-collapse-id']).toBe('booking_offer:offer-1');
    expect(message.apns.headers['apns-expiration']).toBe(String(Math.floor(now.getTime() / 1000) + 45));
    expect(message.apns.payload.aps.alert.title).toBe('New ride request');
    expect(message.apns.payload.aps.alert.body).toBe(
      'Open the app to review this ride request.'
    );
    expect(message.apns.payload.aps.sound).toBe('default');
    expect(JSON.stringify(message.data)).not.toMatch(PRIVATE_DETAIL);
    expect(JSON.stringify(message.apns.payload.aps.alert)).not.toMatch(PRIVATE_DETAIL);
  });

  it('uses generic copy with no private ride details', () => {
    const copy = offerPushNotificationCopy();
    expect(copy.title).toBe('New ride request');
    expect(copy.body).toContain('Open the app to review this ride request.');
    expect(JSON.stringify(copy)).not.toMatch(PRIVATE_DETAIL);
  });

  it('retains Android-compatible data when bookingId is omitted', () => {
    const message = buildDriverOfferFcmMessage({
      token: 'secret-token-should-not-be-asserted-as-payload',
      offerId: 'offer-2',
      ttlSeconds: 20,
      now,
    });
    expect(message.data).toEqual({
      type: 'booking_offer',
      offerId: 'offer-2',
    });
    expect(message.android.priority).toBe('high');
    expect(message.apns.payload.aps.alert.title).toBe('New ride request');
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

  it('maps sender mismatch and APNs auth errors without deleting the token class', () => {
    expect(getFcmErrorCode({ code: 'messaging/mismatched-credential' })).toBe(
      'messaging/mismatched-credential'
    );
    expect(classifyFcmError({ code: 'messaging/mismatched-credential' })).toBe('other');
    expect(getFcmErrorCode({ message: 'third-party-auth-error from APNs' })).toBe(
      'messaging/third-party-auth-error'
    );
    expect(classifyFcmError({ code: 'messaging/third-party-auth-error' })).toBe('other');
    expect(getFcmErrorCode({ code: 'messaging/invalid-argument' })).toBe(
      'messaging/invalid-argument'
    );
    expect(classifyFcmError({ code: 'messaging/invalid-argument' })).toBe('other');
  });
});
