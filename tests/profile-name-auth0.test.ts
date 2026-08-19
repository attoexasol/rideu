const mockUpdateUserName = jest.fn();
const mockFindFirst = jest.fn();
const mockDbUpdate = jest.fn();
const mockAssignment = jest.fn();

jest.mock('../src/services/auth0Management', () => ({
  auth0Management: {
    isConfigured: () => true,
    updateUserName: (...args: unknown[]) => mockUpdateUserName(...args),
  },
}));

jest.mock('../src/repositories/driverVehicleAssignment.repository', () => ({
  findActiveAssignmentWithVehicle: (...args: unknown[]) => mockAssignment(...args),
}));

jest.mock('../src/db/connection', () => ({
  db: {
    query: {
      drivers: {
        findFirst: (...args: unknown[]) => mockFindFirst(...args),
      },
    },
    update: (...args: unknown[]) => mockDbUpdate(...args),
  },
}));

jest.mock('../src/middleware/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

const driverRow = {
  id: 'driver-1',
  auth0Id: 'auth0|driver-1',
  email: 'd@example.com',
  name: 'Old Name',
  phone: null,
  accountStatus: 'active',
  profileImageUrl: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('Auth0 name update ordering', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindFirst.mockResolvedValue(driverRow);
    mockAssignment.mockResolvedValue(null);
    mockDbUpdate.mockReturnValue({
      set: () => ({
        where: jest.fn().mockResolvedValue([driverRow]),
      }),
    });
  });

  it('does not mutate DB name when Auth0 fails', async () => {
    mockUpdateUserName.mockRejectedValue(new Error('Auth0 down'));
    const { updateDriverProfile, ProfileError } = await import('../src/services/profile.service');
    await expect(updateDriverProfile('driver-1', { name: 'New Name' })).rejects.toMatchObject({
      code: 'AUTH0_ERROR',
    });
    expect(mockUpdateUserName).toHaveBeenCalledWith('auth0|driver-1', 'New Name');
    expect(mockDbUpdate).not.toHaveBeenCalled();
    expect(ProfileError).toBeDefined();
  });

  it('updates DB only after Auth0 succeeds', async () => {
    mockUpdateUserName.mockResolvedValue(undefined);
    mockFindFirst
      .mockResolvedValueOnce(driverRow)
      .mockResolvedValueOnce({ ...driverRow, name: 'New Name' });
    const { updateDriverProfile } = await import('../src/services/profile.service');
    await updateDriverProfile('driver-1', { name: 'New Name' });
    expect(mockUpdateUserName).toHaveBeenCalled();
    expect(mockDbUpdate).toHaveBeenCalled();
  });
});
