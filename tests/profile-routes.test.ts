import express from 'express';
import request from 'supertest';
import sharp from 'sharp';

const mockGetDriver = jest.fn();
const mockPatchDriver = jest.fn();
const mockUploadDriver = jest.fn();
const mockDeleteDriver = jest.fn();
const mockDeactivateDriver = jest.fn();
const mockGetPassenger = jest.fn();
const mockPatchPassenger = jest.fn();
const mockUploadPassenger = jest.fn();
const mockDeletePassenger = jest.fn();
const mockDeactivatePassenger = jest.fn();
const mockFindByAuth0Id = jest.fn();
const mockFindCustomerById = jest.fn();

let testRole = 'driver';
let requireAuthEnabled = true;
let testUserId = 'driver-1';
let testAuth0Id = 'auth0|driver-1';

jest.mock('../src/services/profile.service', () => {
  class ProfileError extends Error {
    constructor(
      public code: string,
      message: string,
      public statusCode: number = 400
    ) {
      super(message);
    }
  }
  class AvatarStorageError extends Error {
    constructor(
      public code: string,
      message: string,
      public statusCode: number = 400
    ) {
      super(message);
    }
  }
  return {
    ProfileError,
    AvatarStorageError,
    getDriverProfile: (...args: unknown[]) => mockGetDriver(...args),
    updateDriverProfile: (...args: unknown[]) => mockPatchDriver(...args),
    uploadDriverAvatar: (...args: unknown[]) => mockUploadDriver(...args),
    removeDriverAvatar: (...args: unknown[]) => mockDeleteDriver(...args),
    deactivateDriverAccount: (...args: unknown[]) => mockDeactivateDriver(...args),
    getPassengerProfile: (...args: unknown[]) => mockGetPassenger(...args),
    updatePassengerProfile: (...args: unknown[]) => mockPatchPassenger(...args),
    uploadPassengerAvatar: (...args: unknown[]) => mockUploadPassenger(...args),
    removePassengerAvatar: (...args: unknown[]) => mockDeletePassenger(...args),
    deactivatePassengerAccount: (...args: unknown[]) => mockDeactivatePassenger(...args),
  };
});

jest.mock('../src/db/utils', () => ({
  driverUtils: {
    findByAuth0Id: (...args: unknown[]) => mockFindByAuth0Id(...args),
  },
}));

jest.mock('../src/repositories/customer.repository', () => ({
  findCustomerById: (...args: unknown[]) => mockFindCustomerById(...args),
}));

jest.mock('../src/middleware/auth', () => ({
  requireAuth: (_req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!requireAuthEnabled) {
      res.status(401).json({
        success: false,
        error: { code: 'AUTH_FAILED', message: 'No token provided' },
      });
      return;
    }
    next();
  },
  extractUserInfo: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as any).user = {
      auth0Id: testAuth0Id,
      role: testRole,
      userId: testUserId,
    };
    (req as any).auth = { sessionId: 'sess-active', role: testRole };
    next();
  },
}));

jest.mock('../src/middleware/rbac', () => ({
  requireDriver: [
    (req: express.Request, res: express.Response, next: express.NextFunction) => {
      const user = (req as any).user;
      if (!user || user.role !== 'driver') {
        res.status(403).json({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Access denied. Required role(s): driver' },
        });
        return;
      }
      next();
    },
    (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
  ],
  requireCustomer: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const user = (req as any).user;
    if (!user || user.role !== 'customer') {
      res.status(403).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Access denied. Required role(s): customer' },
      });
      return;
    }
    next();
  },
}));

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

describe('profile routes', () => {
  let driverApp: express.Express;
  let passengerApp: express.Express;

  beforeAll(async () => {
    const driverRoutes = (await import('../src/routes/v1/driver/profile')).default;
    const passengerRoutes = (await import('../src/routes/v1/passenger/profile')).default;
    driverApp = express();
    driverApp.use(express.json());
    driverApp.use('/api/v1/driver/profile', driverRoutes);
    passengerApp = express();
    passengerApp.use(express.json());
    passengerApp.use('/api/v1/passenger/profile', passengerRoutes);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    requireAuthEnabled = true;
    testRole = 'driver';
    testUserId = 'driver-1';
    testAuth0Id = 'auth0|driver-1';
    mockFindByAuth0Id.mockResolvedValue({ id: 'driver-1', auth0Id: 'auth0|driver-1' });
    mockFindCustomerById.mockResolvedValue({ id: 'cus-1' });
    mockGetDriver.mockResolvedValue({
      id: 'driver-1',
      name: 'Driver',
      email: 'd@example.com',
      phone: null,
      profileImageUrl: null,
      accountStatus: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      vehicleSummary: null,
    });
    mockGetPassenger.mockResolvedValue({
      id: 'cus-1',
      name: 'Passenger',
      email: 'p@example.com',
      phone: null,
      profileImageUrl: null,
      accountStatus: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    mockPatchDriver.mockImplementation(async (_id: string, body: any) => ({
      id: 'driver-1',
      name: body.name ?? 'Driver',
      email: 'd@example.com',
      phone: body.phone === null ? null : body.phone ? '+8801712345678' : null,
      profileImageUrl: null,
      accountStatus: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      vehicleSummary: null,
    }));
    mockPatchPassenger.mockImplementation(async (_id: string, body: any) => ({
      id: 'cus-1',
      name: body.name ?? 'Passenger',
      email: 'p@example.com',
      phone: body.phone === null ? null : body.phone ? '+8801712345678' : null,
      profileImageUrl: null,
      accountStatus: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
    }));
    mockUploadDriver.mockResolvedValue({ profileImageUrl: '/uploads/avatars/drivers/x.jpg' });
    mockUploadPassenger.mockResolvedValue({ profileImageUrl: '/uploads/avatars/passengers/x.jpg' });
    mockDeleteDriver.mockResolvedValue({ profileImageUrl: null });
    mockDeletePassenger.mockResolvedValue({ profileImageUrl: null });
    mockDeactivateDriver.mockResolvedValue({ accountStatus: 'deactivated' });
    mockDeactivatePassenger.mockResolvedValue({ accountStatus: 'deactivated' });
  });

  it('GET driver own profile', async () => {
    const res = await request(driverApp).get('/api/v1/driver/profile');
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe('driver-1');
    expect(res.body.data.auth0Id).toBeUndefined();
    expect(mockGetDriver).toHaveBeenCalledWith('driver-1');
  });

  it('GET passenger own profile', async () => {
    testRole = 'customer';
    testUserId = 'cus-1';
    const res = await request(passengerApp).get('/api/v1/passenger/profile');
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe('cus-1');
    expect(res.body.data.auth0Id).toBeUndefined();
    expect(mockGetPassenger).toHaveBeenCalledWith('cus-1');
  });

  it('PATCH driver name', async () => {
    const res = await request(driverApp)
      .patch('/api/v1/driver/profile')
      .send({ name: 'New Driver' });
    expect(res.status).toBe(200);
    expect(mockPatchDriver).toHaveBeenCalledWith('driver-1', { name: 'New Driver' });
  });

  it('PATCH passenger name', async () => {
    testRole = 'customer';
    testUserId = 'cus-1';
    const res = await request(passengerApp)
      .patch('/api/v1/passenger/profile')
      .send({ name: 'New Passenger' });
    expect(res.status).toBe(200);
    expect(mockPatchPassenger).toHaveBeenCalledWith('cus-1', { name: 'New Passenger' });
  });

  it('rejects email on driver PATCH', async () => {
    const res = await request(driverApp)
      .patch('/api/v1/driver/profile')
      .send({ email: 'hack@x.com' });
    expect(res.status).toBe(400);
    expect(mockPatchDriver).not.toHaveBeenCalled();
  });

  it('rejects driver status on profile PATCH', async () => {
    const res = await request(driverApp)
      .patch('/api/v1/driver/profile')
      .send({ status: 'online' });
    expect(res.status).toBe(400);
  });

  it('rejects vehicleId on driver PATCH', async () => {
    const res = await request(driverApp)
      .patch('/api/v1/driver/profile')
      .send({ vehicleId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' });
    expect(res.status).toBe(400);
  });

  it('rejects role/auth0Id/userId', async () => {
    const res = await request(driverApp)
      .patch('/api/v1/driver/profile')
      .send({ role: 'admin', auth0Id: 'auth0|x', userId: 'other' });
    expect(res.status).toBe(400);
  });

  it('PATCH driver phone', async () => {
    const res = await request(driverApp)
      .patch('/api/v1/driver/profile')
      .send({ phone: { countryCode: '+880', number: '1712345678' } });
    expect(res.status).toBe(200);
    expect(mockPatchDriver).toHaveBeenCalled();
  });

  it('PATCH passenger phone', async () => {
    testRole = 'customer';
    testUserId = 'cus-1';
    const res = await request(passengerApp)
      .patch('/api/v1/passenger/profile')
      .send({ phone: { countryCode: '+880', number: '1712345678' } });
    expect(res.status).toBe(200);
  });

  it('phone null removes optional phone', async () => {
    const res = await request(driverApp).patch('/api/v1/driver/profile').send({ phone: null });
    expect(res.status).toBe(200);
    expect(mockPatchDriver.mock.calls[0][1]).toEqual({ phone: null });
  });

  it('uploads jpeg/png/webp avatars', async () => {
    const jpeg = await sharp(PNG_1x1).jpeg().toBuffer();
    const webp = await sharp(PNG_1x1).webp().toBuffer();
    const r1 = await request(driverApp)
      .post('/api/v1/driver/profile/avatar')
      .attach('avatar', jpeg, { filename: 'a.jpg', contentType: 'image/jpeg' });
    const r2 = await request(driverApp)
      .post('/api/v1/driver/profile/avatar')
      .attach('avatar', PNG_1x1, { filename: 'a.png', contentType: 'image/png' });
    const r3 = await request(driverApp)
      .post('/api/v1/driver/profile/avatar')
      .attach('avatar', webp, { filename: 'a.webp', contentType: 'image/webp' });
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(200);
    expect(mockUploadDriver).toHaveBeenCalledTimes(3);
  });

  it('rejects mp4 avatar', async () => {
    const mp4 = Buffer.alloc(32, 0);
    mp4.write('ftypisom', 4, 'ascii');
    const res = await request(driverApp)
      .post('/api/v1/driver/profile/avatar')
      .attach('avatar', mp4, { filename: 'clip.mp4', contentType: 'video/mp4' });
    expect(res.status).toBe(400);
    expect(mockUploadDriver).not.toHaveBeenCalled();
  });

  it('DELETE avatar clears DB via service', async () => {
    const res = await request(driverApp).delete('/api/v1/driver/profile/avatar');
    expect(res.status).toBe(200);
    expect(res.body.data.profileImageUrl).toBeNull();
    expect(mockDeleteDriver).toHaveBeenCalledWith('driver-1');
  });

  it('driver cannot edit passenger profile', async () => {
    testRole = 'driver';
    const res = await request(passengerApp)
      .patch('/api/v1/passenger/profile')
      .send({ name: 'Nope' });
    expect(res.status).toBe(403);
    expect(mockPatchPassenger).not.toHaveBeenCalled();
  });

  it('passenger cannot edit driver profile', async () => {
    testRole = 'customer';
    testUserId = 'cus-1';
    const res = await request(driverApp).patch('/api/v1/driver/profile').send({ name: 'Nope' });
    expect(res.status).toBe(403);
    expect(mockPatchDriver).not.toHaveBeenCalled();
  });

  it('unauthenticated profile PATCH rejected', async () => {
    requireAuthEnabled = false;
    const res = await request(driverApp).patch('/api/v1/driver/profile').send({ name: 'X' });
    expect(res.status).toBe(401);
  });

  it('deactivate requires confirm true', async () => {
    const res = await request(driverApp).post('/api/v1/driver/profile/deactivate').send({});
    expect(res.status).toBe(400);
    const ok = await request(driverApp)
      .post('/api/v1/driver/profile/deactivate')
      .send({ confirm: true });
    expect(ok.status).toBe(200);
    expect(mockDeactivateDriver).toHaveBeenCalledWith('driver-1');
  });
});
