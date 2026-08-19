const mockFindDriverSession = jest.fn();
const mockFindEnabled = jest.fn();
const mockCleanup = jest.fn();
const mockSendFcm = jest.fn();
const mockIsFcmReady = jest.fn();
const mockIsFcmEnabled = jest.fn();

jest.mock('../src/repositories/driverPushToken.repository', () => ({
  findDriverSessionForPush: (...args: unknown[]) => mockFindDriverSession(...args),
  findEnabledPushTokenForDriverDevice: (...args: unknown[]) => mockFindEnabled(...args),
}));

jest.mock('../src/services/driverPushToken.service', () => ({
  cleanupInvalidPushToken: (...args: unknown[]) => mockCleanup(...args),
}));

jest.mock('../src/services/fcmAdmin.service', () => ({
  isFcmReady: (...args: unknown[]) => mockIsFcmReady(...args),
  sendFcmMessage: (...args: unknown[]) => mockSendFcm(...args),
}));

jest.mock('../src/config/fcm', () => ({
  isFcmEnabled: (...args: unknown[]) => mockIsFcmEnabled(...args),
  FCM_TRANSIENT_MAX_ATTEMPTS: 2,
  FCM_TRANSIENT_RETRY_DELAY_MS: 1,
  FCM_OFFER_PUSH_TYPE: 'booking_offer',
  FCM_COLLAPSE_KEY_PREFIX: 'booking_offer',
}));

jest.mock('../src/middleware/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const offerId = '11111111-1111-4111-8111-111111111111';
const bookingId = '22222222-2222-4222-8222-222222222222';
const driverId = '33333333-3333-4333-8333-333333333333';

function futureExpiry(seconds = 40) {
  return new Date(Date.now() + seconds * 1000);
}

describe('sendDriverOfferPush', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsFcmEnabled.mockReturnValue(true);
    mockIsFcmReady.mockResolvedValue(true);
    mockFindDriverSession.mockResolvedValue({
      id: driverId,
      activeDeviceId: 'device-1',
      activeSessionId: 'sess-1',
    });
    mockFindEnabled.mockResolvedValue({
      id: 'token-row-1',
      driverId,
      deviceId: 'device-1',
      sessionId: 'sess-1',
      fcmToken: 'fcm-token',
      enabled: true,
    });
    mockSendFcm.mockResolvedValue('projects/test/messages/1');
    mockCleanup.mockResolvedValue(undefined);
  });

  it('sends once with persisted offerId and identifier-only data payload', async () => {
    const { sendDriverOfferPush } = await import('../src/services/driverOfferPush.service');
    const expiresAt = futureExpiry(40);
    const result = await sendDriverOfferPush({ driverId, bookingId, offerId, expiresAt });
    expect(result.pushAttempted).toBe(true);
    expect(result.pushSent).toBe(true);
    expect(mockSendFcm).toHaveBeenCalledTimes(1);
    const message = mockSendFcm.mock.calls[0][0];
    expect(message.data).toEqual({
      type: 'booking_offer',
      offerId,
      bookingId,
    });
    expect(Object.keys(message.data).sort()).toEqual(['bookingId', 'offerId', 'type']);
    expect(message.android.priority).toBe('high');
    expect(message.android.ttl).toBeLessThanOrEqual(40_000);
    expect(message.android.collapseKey).toBe(`booking_offer:${offerId}`);
  });

  it('does not send for an expired offer', async () => {
    const { sendDriverOfferPush } = await import('../src/services/driverOfferPush.service');
    const result = await sendDriverOfferPush({
      driverId,
      bookingId,
      offerId,
      expiresAt: new Date(Date.now() - 1000),
    });
    expect(result.pushAttempted).toBe(false);
    expect(result.pushFailureCode).toBe('OFFER_EXPIRED');
    expect(mockSendFcm).not.toHaveBeenCalled();
  });

  it('does not fail when the driver has no token', async () => {
    mockFindEnabled.mockResolvedValue(null);
    const { sendDriverOfferPush } = await import('../src/services/driverOfferPush.service');
    const result = await sendDriverOfferPush({
      driverId,
      bookingId,
      offerId,
      expiresAt: futureExpiry(),
    });
    expect(result.pushSent).toBe(false);
    expect(result.pushFailureCode).toBe('NO_TOKEN');
    expect(mockSendFcm).not.toHaveBeenCalled();
  });

  it('does not fail when FCM is disabled', async () => {
    mockIsFcmEnabled.mockReturnValue(false);
    const { sendDriverOfferPush } = await import('../src/services/driverOfferPush.service');
    const result = await sendDriverOfferPush({
      driverId,
      bookingId,
      offerId,
      expiresAt: futureExpiry(),
    });
    expect(result.pushFailureCode).toBe('FCM_DISABLED');
    expect(mockSendFcm).not.toHaveBeenCalled();
  });

  it('does not throw when FCM send throws', async () => {
    mockSendFcm.mockRejectedValue({ code: 'messaging/internal-error' });
    const { sendDriverOfferPush } = await import('../src/services/driverOfferPush.service');
    const result = await sendDriverOfferPush({
      driverId,
      bookingId,
      offerId,
      expiresAt: futureExpiry(),
    });
    expect(result.pushAttempted).toBe(true);
    expect(result.pushSent).toBe(false);
    expect(result.pushFailureCode).toBe('messaging/internal-error');
  });

  it('cleans up invalid/unregistered tokens', async () => {
    mockSendFcm.mockRejectedValue({ code: 'messaging/registration-token-not-registered' });
    const { sendDriverOfferPush } = await import('../src/services/driverOfferPush.service');
    const result = await sendDriverOfferPush({
      driverId,
      bookingId,
      offerId,
      expiresAt: futureExpiry(),
    });
    expect(mockCleanup).toHaveBeenCalledWith('token-row-1');
    expect(result.pushSent).toBe(false);
    expect(mockSendFcm).toHaveBeenCalledTimes(1);
  });

  it('retries transient errors a bounded number of times', async () => {
    mockSendFcm
      .mockRejectedValueOnce({ code: 'messaging/unavailable' })
      .mockResolvedValueOnce('ok');
    const { sendDriverOfferPush } = await import('../src/services/driverOfferPush.service');
    const result = await sendDriverOfferPush({
      driverId,
      bookingId,
      offerId,
      expiresAt: futureExpiry(),
    });
    expect(mockSendFcm).toHaveBeenCalledTimes(2);
    expect(result.pushSent).toBe(true);
  });

  it('scheduleDriverOfferPush swallows isolated exceptions', async () => {
    mockSendFcm.mockRejectedValue(new Error('boom'));
    const { scheduleDriverOfferPush } = await import('../src/services/driverOfferPush.service');
    expect(() =>
      scheduleDriverOfferPush({
        driverId,
        bookingId,
        offerId,
        expiresAt: futureExpiry(),
      })
    ).not.toThrow();
    await new Promise((r) => setTimeout(r, 20));
  });
});
