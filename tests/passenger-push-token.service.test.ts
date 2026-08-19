import type { Customer } from '../src/db/schema/customers';

const mockUpsert = jest.fn();
const mockDeleteForCustomer = jest.fn();
const mockDeleteExceptDevice = jest.fn();
const mockFindEnabled = jest.fn();
const mockDeleteById = jest.fn();
const mockUpdateSession = jest.fn();
const mockFindCustomerSession = jest.fn();

jest.mock('../src/repositories/passengerPushToken.repository', () => ({
  upsertPassengerPushToken: (...args: unknown[]) => mockUpsert(...args),
  deletePassengerPushTokensForCustomer: (...args: unknown[]) => mockDeleteForCustomer(...args),
  deletePassengerPushTokensForCustomerExceptDevice: (...args: unknown[]) =>
    mockDeleteExceptDevice(...args),
  findEnabledPushTokenForPassengerDevice: (...args: unknown[]) => mockFindEnabled(...args),
  deletePassengerPushTokenById: (...args: unknown[]) => mockDeleteById(...args),
  updatePassengerPushTokenSessionForDevice: (...args: unknown[]) => mockUpdateSession(...args),
  findCustomerSessionForPush: (...args: unknown[]) => mockFindCustomerSession(...args),
}));

jest.mock('../src/middleware/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

function makeCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: 'cus-1',
    auth0Id: 'auth0|passenger-1',
    email: 'p@example.com',
    name: 'Passenger',
    phoneCountryCode: null,
    phoneNumber: null,
    profileImageUrl: null,
    status: 'active',
    emailVerifiedAt: null,
    phoneVerifiedAt: null,
    activeSessionId: 'sess-active',
    activeDeviceId: 'device-active',
    activeDeviceInfo: 'Pixel',
    lastLoginAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('passenger push token lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUpsert.mockResolvedValue({
      id: 'token-row-1',
      customerId: 'cus-1',
      deviceId: 'device-active',
      sessionId: 'sess-active',
      fcmToken: 'fcm-new',
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastRegisteredAt: new Date('2026-08-19T00:00:00.000Z'),
    });
    mockDeleteForCustomer.mockResolvedValue(1);
    mockDeleteExceptDevice.mockResolvedValue(1);
    mockFindEnabled.mockResolvedValue({
      id: 'token-row-1',
      customerId: 'cus-1',
      deviceId: 'device-active',
      sessionId: 'sess-active',
      enabled: true,
    });
    mockDeleteById.mockResolvedValue(undefined);
    mockUpdateSession.mockResolvedValue(undefined);
    mockFindCustomerSession.mockResolvedValue({
      id: 'cus-1',
      activeDeviceId: 'device-active',
      activeSessionId: 'sess-active',
    });
  });

  it('registers token against authenticated customer active device/session', async () => {
    const { registerPassengerPushToken } = await import(
      '../src/services/passengerPushToken.service'
    );
    const result = await registerPassengerPushToken({
      customer: makeCustomer(),
      fcmToken: 'fcm-new',
      requestDeviceId: 'device-active',
      requestSessionId: 'sess-active',
    });
    expect(mockUpsert).toHaveBeenCalledWith({
      customerId: 'cus-1',
      deviceId: 'device-active',
      sessionId: 'sess-active',
      fcmToken: 'fcm-new',
    });
    expect(result.deviceId).toBe('device-active');
    expect(JSON.stringify(result)).not.toMatch(/fcm-new/);
  });

  it('ignores body customerId and uses authenticated customer id', async () => {
    const { registerPassengerPushToken } = await import(
      '../src/services/passengerPushToken.service'
    );
    await registerPassengerPushToken({
      customer: makeCustomer({ id: 'authenticated-customer' }),
      fcmToken: 'fcm-new',
      requestDeviceId: 'device-active',
      requestSessionId: 'sess-active',
    });
    expect(mockUpsert.mock.calls[0][0].customerId).toBe('authenticated-customer');
    expect(mockUpsert.mock.calls[0][0].customerId).not.toBe('attacker-customer');
  });

  it('requires X-Device-ID', async () => {
    const { registerPassengerPushToken } = await import(
      '../src/services/passengerPushToken.service'
    );
    await expect(
      registerPassengerPushToken({
        customer: makeCustomer(),
        fcmToken: 'fcm-new',
        requestDeviceId: null,
        requestSessionId: 'sess-active',
      })
    ).rejects.toMatchObject({ code: 'DEVICE_REQUIRED', statusCode: 400 });
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('rejects device mismatch', async () => {
    const { registerPassengerPushToken } = await import(
      '../src/services/passengerPushToken.service'
    );
    await expect(
      registerPassengerPushToken({
        customer: makeCustomer(),
        fcmToken: 'fcm-new',
        requestDeviceId: 'device-other',
        requestSessionId: 'sess-active',
      })
    ).rejects.toMatchObject({ code: 'DEVICE_MISMATCH', statusCode: 400 });
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('rejects session mismatch', async () => {
    const { registerPassengerPushToken } = await import(
      '../src/services/passengerPushToken.service'
    );
    await expect(
      registerPassengerPushToken({
        customer: makeCustomer(),
        fcmToken: 'fcm-new',
        requestDeviceId: 'device-active',
        requestSessionId: 'sess-old',
      })
    ).rejects.toMatchObject({ code: 'SESSION_INVALID', statusCode: 401 });
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('rejects missing active device/session on the customer row', async () => {
    const { registerPassengerPushToken } = await import(
      '../src/services/passengerPushToken.service'
    );
    await expect(
      registerPassengerPushToken({
        customer: makeCustomer({ activeDeviceId: null, activeSessionId: null }),
        fcmToken: 'fcm-new',
        requestDeviceId: 'device-active',
        requestSessionId: 'sess-active',
      })
    ).rejects.toMatchObject({ code: 'DEVICE_REQUIRED' });
  });

  it('logout invalidates all passenger tokens', async () => {
    const { invalidatePassengerPushTargets } = await import(
      '../src/services/passengerPushToken.service'
    );
    await invalidatePassengerPushTargets('cus-1');
    expect(mockDeleteForCustomer).toHaveBeenCalledWith('cus-1');
  });

  it('new-device login invalidates old device push targets', async () => {
    const { onPassengerSessionReplaced } = await import(
      '../src/services/passengerPushToken.service'
    );
    await onPassengerSessionReplaced({
      customerId: 'cus-1',
      newDeviceId: 'device-new',
      newSessionId: 'sess-new',
      previousDeviceId: 'device-old',
    });
    expect(mockDeleteForCustomer).toHaveBeenCalledWith('cus-1');
    expect(mockUpdateSession).not.toHaveBeenCalled();
  });

  it('same-device login keeps token and updates session id', async () => {
    const { onPassengerSessionReplaced } = await import(
      '../src/services/passengerPushToken.service'
    );
    await onPassengerSessionReplaced({
      customerId: 'cus-1',
      newDeviceId: 'device-active',
      newSessionId: 'sess-new',
      previousDeviceId: 'device-active',
    });
    expect(mockDeleteForCustomer).not.toHaveBeenCalled();
    expect(mockDeleteExceptDevice).toHaveBeenCalledWith('cus-1', 'device-active');
    expect(mockUpdateSession).toHaveBeenCalledWith('cus-1', 'device-active', 'sess-new');
  });

  it('findEnabledPassengerPushTokenForActiveDevice rejects stale session tokens', async () => {
    mockFindEnabled.mockResolvedValue({
      id: 'token-row-1',
      customerId: 'cus-1',
      deviceId: 'device-active',
      sessionId: 'sess-old',
      enabled: true,
    });
    const { findEnabledPassengerPushTokenForActiveDevice } = await import(
      '../src/services/passengerPushToken.service'
    );
    const matched = await findEnabledPassengerPushTokenForActiveDevice('cus-1');
    expect(matched).toBeNull();
  });
});
