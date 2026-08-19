import fs from 'fs';
import path from 'path';

const mockFindFirst = jest.fn();
const mockDbUpdate = jest.fn();
const mockHasRide = jest.fn();
const mockEndDuty = jest.fn();
const mockClearSession = jest.fn();
const mockDeleteAllForUser = jest.fn();
const mockInvalidatePush = jest.fn();
const mockFindCustomer = jest.fn();
const mockUpdateCustomer = jest.fn();
const mockClearCustomer = jest.fn();
const mockSetStatus = jest.fn();

jest.mock('../src/db/connection', () => ({
  db: {
    query: { drivers: { findFirst: (...args: unknown[]) => mockFindFirst(...args) } },
    update: (...args: unknown[]) => mockDbUpdate(...args),
    delete: jest.fn(() => {
      throw new Error('profile deactivate must not hard-delete rows');
    }),
  },
}));

jest.mock('../src/services/duty.service', () => ({
  DutyError: class DutyError extends Error {
    constructor(
      public code: string,
      message: string
    ) {
      super(message);
    }
  },
  driverHasActiveRide: (...args: unknown[]) => mockHasRide(...args),
  endDuty: (...args: unknown[]) => mockEndDuty(...args),
}));

jest.mock('../src/db/utils', () => ({
  driverUtils: { clearSessionInfo: (...args: unknown[]) => mockClearSession(...args) },
  sessionUtils: { deleteAllForUser: (...args: unknown[]) => mockDeleteAllForUser(...args) },
}));

jest.mock('../src/services/driverPushToken.service', () => ({
  invalidateDriverPushTargets: (...args: unknown[]) => mockInvalidatePush(...args),
}));

const mockInvalidatePassengerPush = jest.fn();
jest.mock('../src/services/passengerPushToken.service', () => ({
  invalidatePassengerPushTargets: (...args: unknown[]) => mockInvalidatePassengerPush(...args),
}));

jest.mock('../src/repositories/customer.repository', () => ({
  findCustomerById: (...args: unknown[]) => mockFindCustomer(...args),
  updateCustomerProfile: (...args: unknown[]) => mockUpdateCustomer(...args),
  clearCustomerSession: (...args: unknown[]) => mockClearCustomer(...args),
}));

jest.mock('../src/config/redis', () => ({
  realtimeCache: { setDriverStatus: (...args: unknown[]) => mockSetStatus(...args) },
}));

jest.mock('../src/middleware/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

describe('account deactivation preserves history', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindFirst.mockResolvedValue({
      id: 'driver-1',
      accountStatus: 'active',
    });
    mockHasRide.mockResolvedValue(true);
    mockDbUpdate.mockReturnValue({
      set: () => ({
        where: jest.fn().mockResolvedValue([]),
      }),
    });
    mockFindCustomer.mockResolvedValue({
      id: 'cus-1',
      status: 'active',
    });
    mockUpdateCustomer.mockResolvedValue({ id: 'cus-1', status: 'deactivated' });
  });

  it('driver deactivate does not end duty during an active ride and does not delete bookings/video', async () => {
    const { deactivateDriverAccount } = await import('../src/services/profile.service');
    const result = await deactivateDriverAccount('driver-1');
    expect(result.accountStatus).toBe('deactivated');
    expect(mockEndDuty).not.toHaveBeenCalled();
    expect(mockClearSession).toHaveBeenCalledWith('driver-1');
    expect(mockDeleteAllForUser).toHaveBeenCalledWith('driver-1');
    expect(mockInvalidatePush).toHaveBeenCalledWith('driver-1');
  });

  it('passenger deactivate sets status and does not delete customer or bookings', async () => {
    const { deactivatePassengerAccount } = await import('../src/services/profile.service');
    const result = await deactivatePassengerAccount('cus-1');
    expect(result.accountStatus).toBe('deactivated');
    expect(mockUpdateCustomer).toHaveBeenCalledWith('cus-1', { status: 'deactivated' });
    expect(mockClearCustomer).toHaveBeenCalledWith('cus-1');
    expect(mockDeleteAllForUser).toHaveBeenCalledWith('cus-1');
    expect(mockInvalidatePassengerPush).toHaveBeenCalledWith('cus-1');
  });

  it('source does not hard-delete bookings or video sessions', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'src/services/profile.service.ts'),
      'utf8'
    );
    expect(src).not.toMatch(/delete\(bookings\)/);
    expect(src).not.toMatch(/delete\(videoSessions\)/);
    expect(src).not.toMatch(/auth0Management\.deleteUser/);
    expect(src).toContain('ACCOUNT_STATUS_DEACTIVATED');
  });
});
