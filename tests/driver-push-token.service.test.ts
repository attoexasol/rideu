import type { Driver } from '../src/db/schema/drivers';

const mockUpsert = jest.fn();
const mockDeleteForDriver = jest.fn();
const mockDeleteExceptDevice = jest.fn();
const mockFindEnabled = jest.fn();
const mockDeleteById = jest.fn();
const mockUpdateSession = jest.fn();

jest.mock('../src/repositories/driverPushToken.repository', () => ({
  upsertDriverPushToken: (...args: unknown[]) => mockUpsert(...args),
  deletePushTokensForDriver: (...args: unknown[]) => mockDeleteForDriver(...args),
  deletePushTokensForDriverExceptDevice: (...args: unknown[]) => mockDeleteExceptDevice(...args),
  findEnabledPushTokenForDriverDevice: (...args: unknown[]) => mockFindEnabled(...args),
  deletePushTokenById: (...args: unknown[]) => mockDeleteById(...args),
  updatePushTokenSessionForDevice: (...args: unknown[]) => mockUpdateSession(...args),
}));

jest.mock('../src/middleware/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

function makeDriver(overrides: Partial<Driver> = {}): Driver {
  return {
    id: 'driver-1',
    auth0Id: 'auth0|driver-1',
    email: 'd@example.com',
    name: 'Driver',
    phone: null,
    status: 'online',
    vehicleType: null,
    vehicleId: null,
    cabName: null,
    cabNumber: null,
    cabLicence: null,
    vehicleMake: null,
    vehicleModel: null,
    vehicleYear: null,
    vehicleColor: null,
    qrCode: null,
    vehicleQrCode: null,
    lastSeen: null,
    activeSessionId: 'sess-active',
    activeDeviceId: 'device-active',
    activeDeviceInfo: 'Pixel',
    lastLoginAt: new Date(),
    profileImageUrl: null,
    accountStatus: 'active',
    stripeAccountId: null,
    stripeAccountCountry: null,
    stripeAccountStatus: null,
    stripeDetailsSubmitted: false,
    stripeChargesEnabled: false,
    stripePayoutsEnabled: false,
    stripeRequirementsCurrentlyDue: [],
    stripeRequirementsEventuallyDue: [],
    stripeOnboardingCompletedAt: null,
    stripeLastSyncedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('driver push token lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUpsert.mockResolvedValue({
      id: 'token-row-1',
      driverId: 'driver-1',
      deviceId: 'device-active',
      sessionId: 'sess-active',
      fcmToken: 'fcm-new',
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastRegisteredAt: new Date('2026-08-18T00:00:00.000Z'),
    });
    mockDeleteForDriver.mockResolvedValue(1);
    mockDeleteExceptDevice.mockResolvedValue(1);
    mockFindEnabled.mockResolvedValue({ id: 'token-row-1' });
    mockDeleteById.mockResolvedValue(undefined);
    mockUpdateSession.mockResolvedValue(undefined);
  });

  it('registers token against authenticated active device/session', async () => {
    const { registerDriverPushToken } = await import('../src/services/driverPushToken.service');
    const result = await registerDriverPushToken({
      driver: makeDriver(),
      fcmToken: 'fcm-new',
      requestDeviceId: 'device-active',
      requestSessionId: 'sess-active',
    });
    expect(mockUpsert).toHaveBeenCalledWith({
      driverId: 'driver-1',
      deviceId: 'device-active',
      sessionId: 'sess-active',
      fcmToken: 'fcm-new',
    });
    expect(result.deviceId).toBe('device-active');
    expect(mockUpsert.mock.calls[0][0].driverId).toBe('driver-1');
  });

  it('ignores body driverId and uses authenticated driver id', async () => {
    const { registerDriverPushToken } = await import('../src/services/driverPushToken.service');
    await registerDriverPushToken({
      driver: makeDriver({ id: 'authenticated-driver' }),
      fcmToken: 'fcm-new',
      requestDeviceId: 'device-active',
      requestSessionId: 'sess-active',
    });
    expect(mockUpsert.mock.calls[0][0].driverId).toBe('authenticated-driver');
    expect(mockUpsert.mock.calls[0][0].driverId).not.toBe('attacker-driver');
  });

  it('rejects token refresh from an inactivated session', async () => {
    const { registerDriverPushToken, DriverPushTokenError } = await import(
      '../src/services/driverPushToken.service'
    );
    await expect(
      registerDriverPushToken({
        driver: makeDriver(),
        fcmToken: 'fcm-new',
        requestDeviceId: 'device-active',
        requestSessionId: 'sess-old',
      })
    ).rejects.toMatchObject({ code: 'SESSION_INVALID', statusCode: 401 });
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(DriverPushTokenError).toBeDefined();
  });

  it('token refresh overwrites the active device token', async () => {
    const { registerDriverPushToken } = await import('../src/services/driverPushToken.service');
    await registerDriverPushToken({
      driver: makeDriver(),
      fcmToken: 'fcm-refreshed',
      requestDeviceId: 'device-active',
      requestSessionId: 'sess-active',
    });
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ fcmToken: 'fcm-refreshed', deviceId: 'device-active' })
    );
  });

  it('logout removes all push targets for the driver', async () => {
    const { invalidateDriverPushTargets } = await import('../src/services/driverPushToken.service');
    await invalidateDriverPushTargets('driver-1');
    expect(mockDeleteForDriver).toHaveBeenCalledWith('driver-1');
  });

  it('new-device login invalidates old device push targets', async () => {
    const { onDriverSessionReplaced } = await import('../src/services/driverPushToken.service');
    await onDriverSessionReplaced({
      driverId: 'driver-1',
      newDeviceId: 'device-new',
      newSessionId: 'sess-new',
      previousDeviceId: 'device-old',
    });
    expect(mockDeleteForDriver).toHaveBeenCalledWith('driver-1');
    expect(mockUpdateSession).not.toHaveBeenCalled();
  });

  it('same-device login keeps token and updates session id', async () => {
    const { onDriverSessionReplaced } = await import('../src/services/driverPushToken.service');
    await onDriverSessionReplaced({
      driverId: 'driver-1',
      newDeviceId: 'device-active',
      newSessionId: 'sess-new',
      previousDeviceId: 'device-active',
    });
    expect(mockDeleteForDriver).not.toHaveBeenCalled();
    expect(mockDeleteExceptDevice).toHaveBeenCalledWith('driver-1', 'device-active');
    expect(mockUpdateSession).toHaveBeenCalledWith('driver-1', 'device-active', 'sess-new');
  });
});
