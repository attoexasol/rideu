const mockFindCustomer = jest.fn();
const mockVerify = jest.fn();
const mockUpdateSession = jest.fn();
const mockCreateSession = jest.fn();

jest.mock('../src/repositories/customer.repository', () => ({
  findCustomerByAuth0Id: (...args: unknown[]) => mockFindCustomer(...args),
  findCustomerByEmail: jest.fn(),
  insertCustomer: jest.fn(),
  updateCustomerSession: (...args: unknown[]) => mockUpdateSession(...args),
  clearCustomerSession: jest.fn(),
}));

jest.mock('../src/utils/jwt-verifier', () => ({
  isAuth0Configured: () => false,
  verifyAuth0Token: (...args: unknown[]) => mockVerify(...args),
}));

jest.mock('../src/db/utils', () => ({
  sessionUtils: {
    create: (...args: unknown[]) => mockCreateSession(...args),
    deleteByToken: jest.fn(),
  },
}));

jest.mock('../src/services/auth0Management', () => ({
  auth0Management: { isConfigured: () => true, createCustomer: jest.fn() },
  PasswordResetError: class PasswordResetError extends Error {},
}));

describe('deactivated passenger cannot login', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindCustomer.mockResolvedValue({
      id: 'cus-1',
      auth0Id: 'auth0|p',
      name: 'P',
      email: 'p@example.com',
      status: 'deactivated',
    });
  });

  it('throws ACCOUNT_DEACTIVATED and does not issue a session', async () => {
    const jwt = await import('jsonwebtoken');
    const token = jwt.default.sign({ sub: 'auth0|p' }, 'test');
    const { loginPassenger } = await import('../src/services/passengerAuth.service');
    const { AccountDeactivatedError } = await import('../src/services/accountStatus.service');
    await expect(loginPassenger({ auth0Token: token })).rejects.toBeInstanceOf(
      AccountDeactivatedError
    );
    expect(mockUpdateSession).not.toHaveBeenCalled();
    expect(mockCreateSession).not.toHaveBeenCalled();
  });
});
