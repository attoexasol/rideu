import {
  buildAndroidPassengerRideFcmMessage,
  buildPassengerRidePushDataPayload,
  mapPassengerPushFailureCode,
  passengerRidePushCollapseKey,
  passengerRidePushPriority,
  passengerRidePushTtlSeconds,
  shouldSendPassengerRidePush,
} from '../src/services/passengerRidePush.payload';

describe('passenger ride push payload', () => {
  it('contains only allowed data fields', () => {
    const payload = buildPassengerRidePushDataPayload({
      bookingId: 'booking-1',
      event: 'arrived',
    });
    expect(payload).toEqual({
      type: 'ride_event',
      bookingId: 'booking-1',
      event: 'arrived',
    });
    expect(Object.keys(payload).sort()).toEqual(['bookingId', 'event', 'type']);
    expect(payload).not.toHaveProperty('phone');
    expect(payload).not.toHaveProperty('fare');
    expect(payload).not.toHaveProperty('jwt');
  });

  it('includes cancelledBy only for cancelled events', () => {
    const cancelled = buildPassengerRidePushDataPayload({
      bookingId: 'booking-1',
      event: 'cancelled',
      cancelledBy: 'driver',
    });
    expect(cancelled.cancelledBy).toBe('driver');
    const arrived = buildPassengerRidePushDataPayload({
      bookingId: 'booking-1',
      event: 'arrived',
      cancelledBy: 'driver',
    });
    expect(arrived.cancelledBy).toBeUndefined();
  });

  it('does not use accepted as a push event', () => {
    expect(shouldSendPassengerRidePush('accepted')).toBe(false);
    expect(shouldSendPassengerRidePush('driver_en_route')).toBe(true);
    expect(shouldSendPassengerRidePush('searching')).toBe(false);
  });

  it('uses a collapse key per booking', () => {
    expect(passengerRidePushCollapseKey('booking-uuid')).toBe('ride_event:booking-uuid');
  });

  it('applies TTL and priority policy', () => {
    expect(passengerRidePushPriority('driver_en_route')).toBe('high');
    expect(passengerRidePushTtlSeconds('driver_en_route')).toBe(180);
    expect(passengerRidePushPriority('arrived')).toBe('high');
    expect(passengerRidePushTtlSeconds('arrived')).toBe(90);
    expect(passengerRidePushPriority('in_progress')).toBe('high');
    expect(passengerRidePushTtlSeconds('in_progress')).toBe(120);
    expect(passengerRidePushPriority('cancelled')).toBe('high');
    expect(passengerRidePushTtlSeconds('cancelled')).toBe(300);
    expect(passengerRidePushPriority('no_drivers')).toBe('normal');
    expect(passengerRidePushTtlSeconds('no_drivers')).toBe(600);
    expect(passengerRidePushPriority('completed')).toBe('normal');
    expect(passengerRidePushTtlSeconds('completed')).toBe(1800);
  });

  it('builds notification plus data without PII', () => {
    const message = buildAndroidPassengerRideFcmMessage({
      token: 'secret-token-should-not-appear-in-data',
      bookingId: 'booking-1',
      event: 'driver_en_route',
    });
    expect(message.notification.title).toBe('Your driver accepted the ride');
    expect(message.notification.body).toBe('Open the app to view ride details.');
    expect(message.android.notification.channelId).toBe('ride_updates');
    expect(message.android.collapseKey).toBe('ride_event:booking-1');
    expect(message.android.priority).toBe('high');
    expect(message.android.ttl).toBe(180_000);
    expect(message.data).toEqual({
      type: 'ride_event',
      bookingId: 'booking-1',
      event: 'driver_en_route',
    });
    expect(message.data).not.toHaveProperty('phone');
    expect(message.data).not.toHaveProperty('fare');
    expect(message.data).not.toHaveProperty('jwt');
  });

  it('maps FCM error codes to diagnostics', () => {
    expect(mapPassengerPushFailureCode('messaging/registration-token-not-registered')).toBe(
      'UNREGISTERED'
    );
    expect(mapPassengerPushFailureCode('messaging/invalid-argument')).toBe('INVALID_ARGUMENT');
    expect(mapPassengerPushFailureCode('messaging/mismatched-credential')).toBe('SENDER_ID_MISMATCH');
    expect(mapPassengerPushFailureCode('messaging/third-party-auth-error')).toBe(
      'THIRD_PARTY_AUTH_ERROR'
    );
    expect(mapPassengerPushFailureCode('messaging/unavailable')).toBe('UNAVAILABLE');
  });
});
