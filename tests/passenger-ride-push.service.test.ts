const mockFindCustomerSession = jest.fn();
const mockFindEnabled = jest.fn();
const mockCleanup = jest.fn();
const mockSendFcm = jest.fn();
const mockIsFcmReady = jest.fn();
const mockIsFcmEnabled = jest.fn();

jest.mock('../src/repositories/passengerPushToken.repository', () => ({
  findCustomerSessionForPush: (...args: unknown[]) => mockFindCustomerSession(...args),
  findEnabledPushTokenForPassengerDevice: (...args: unknown[]) => mockFindEnabled(...args),
}));

jest.mock('../src/services/passengerPushToken.service', () => ({
  cleanupInvalidPassengerPushToken: (...args: unknown[]) => mockCleanup(...args),
  findEnabledPassengerPushTokenForActiveDevice: jest.fn(),
}));

jest.mock('../src/services/fcmAdmin.service', () => ({
  isFcmReady: (...args: unknown[]) => mockIsFcmReady(...args),
  sendFcmMessage: (...args: unknown[]) => mockSendFcm(...args),
}));

jest.mock('../src/config/fcm', () => ({
  isFcmEnabled: (...args: unknown[]) => mockIsFcmEnabled(...args),
  FCM_TRANSIENT_MAX_ATTEMPTS: 2,
  FCM_TRANSIENT_RETRY_DELAY_MS: 1,
  FCM_RIDE_EVENT_TYPE: 'ride_event',
  FCM_RIDE_EVENT_COLLAPSE_PREFIX: 'ride_event',
  FCM_RIDE_UPDATES_CHANNEL_ID: 'ride_updates',
}));

jest.mock('../src/middleware/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const bookingId = '22222222-2222-4222-8222-222222222222';
const customerId = '44444444-4444-4444-8444-444444444444';

describe('sendPassengerRidePush', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsFcmEnabled.mockReturnValue(true);
    mockIsFcmReady.mockResolvedValue(true);
    mockFindCustomerSession.mockResolvedValue({
      id: customerId,
      activeDeviceId: 'device-1',
      activeSessionId: 'sess-1',
    });
    mockFindEnabled.mockResolvedValue({
      id: 'token-row-1',
      customerId,
      deviceId: 'device-1',
      sessionId: 'sess-1',
      fcmToken: 'fcm-token',
      enabled: true,
    });
    mockSendFcm.mockResolvedValue('projects/test/messages/1');
    mockCleanup.mockResolvedValue(undefined);
  });

  it('sends notification+data for driver_en_route', async () => {
    const { sendPassengerRidePush } = await import('../src/services/passengerRidePush.service');
    const result = await sendPassengerRidePush({
      customerId,
      bookingId,
      event: 'driver_en_route',
    });
    expect(result.pushAttempted).toBe(true);
    expect(result.pushSent).toBe(true);
    const message = mockSendFcm.mock.calls[0][0];
    expect(message.data).toEqual({
      type: 'ride_event',
      bookingId,
      event: 'driver_en_route',
    });
    expect(message.notification.title).toBe('Your driver accepted the ride');
    expect(message.android.collapseKey).toBe(`ride_event:${bookingId}`);
  });

  it('does not send accepted as an event', async () => {
    const { sendPassengerRidePush } = await import('../src/services/passengerRidePush.service');
    const result = await sendPassengerRidePush({
      customerId,
      bookingId,
      event: 'accepted',
    });
    expect(result.pushSent).toBe(false);
    expect(result.pushFailureCode).toBe('EVENT_NOT_ELIGIBLE');
    expect(mockSendFcm).not.toHaveBeenCalled();
  });

  it('does not fail when FCM is disabled', async () => {
    mockIsFcmEnabled.mockReturnValue(false);
    const { sendPassengerRidePush } = await import('../src/services/passengerRidePush.service');
    const result = await sendPassengerRidePush({
      customerId,
      bookingId,
      event: 'arrived',
    });
    expect(result.pushFailureCode).toBe('FCM_DISABLED');
    expect(result.pushSent).toBe(false);
    expect(mockSendFcm).not.toHaveBeenCalled();
  });

  it('does not fail when there is no token', async () => {
    mockFindEnabled.mockResolvedValue(null);
    const { sendPassengerRidePush } = await import('../src/services/passengerRidePush.service');
    const result = await sendPassengerRidePush({
      customerId,
      bookingId,
      event: 'arrived',
    });
    expect(result.pushFailureCode).toBe('NO_TOKEN');
    expect(result.pushSent).toBe(false);
  });

  it('does not use a stale-device or stale-session token', async () => {
    mockFindEnabled.mockResolvedValue({
      id: 'token-row-1',
      customerId,
      deviceId: 'device-1',
      sessionId: 'sess-old',
      fcmToken: 'fcm-token',
      enabled: true,
    });
    const { sendPassengerRidePush } = await import('../src/services/passengerRidePush.service');
    const result = await sendPassengerRidePush({
      customerId,
      bookingId,
      event: 'arrived',
    });
    expect(result.pushFailureCode).toBe('SESSION_MISMATCH');
    expect(mockSendFcm).not.toHaveBeenCalled();
  });

  it('does not throw when FCM send throws', async () => {
    mockSendFcm.mockRejectedValue({ code: 'messaging/internal-error' });
    const { sendPassengerRidePush } = await import('../src/services/passengerRidePush.service');
    const result = await sendPassengerRidePush({
      customerId,
      bookingId,
      event: 'completed',
    });
    expect(result.pushAttempted).toBe(true);
    expect(result.pushSent).toBe(false);
    expect(result.pushFailureCode).toBe('UNAVAILABLE');
  });

  it('cleans up unregistered tokens', async () => {
    mockSendFcm.mockRejectedValue({ code: 'messaging/registration-token-not-registered' });
    const { sendPassengerRidePush } = await import('../src/services/passengerRidePush.service');
    const result = await sendPassengerRidePush({
      customerId,
      bookingId,
      event: 'arrived',
    });
    expect(mockCleanup).toHaveBeenCalledWith('token-row-1');
    expect(result.pushFailureCode).toBe('UNREGISTERED');
  });

  it('schedulePassengerRidePush swallows isolated exceptions', async () => {
    mockSendFcm.mockRejectedValue(new Error('boom'));
    const { schedulePassengerRidePush, sendPassengerRidePush } = await import(
      '../src/services/passengerRidePush.service'
    );
    expect(() =>
      schedulePassengerRidePush({
        customerId,
        bookingId,
        event: 'arrived',
      })
    ).not.toThrow();
    await sendPassengerRidePush({
      customerId,
      bookingId,
      event: 'arrived',
    });
  });
});
