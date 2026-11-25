import fs from 'fs';
import path from 'path';
import express from 'express';
import request from 'supertest';

const mockIsConfigured = jest.fn();
const mockFindUserByEmail = jest.fn();
const mockCreateUser = jest.fn();
const mockSendReset = jest.fn();
const mockDeleteUser = jest.fn();
const mockQr = jest.fn();
const mockVehicleQr = jest.fn();

let nameOf: (table: unknown) => string = () => 'unknown';
let selectQueue: unknown[][] | null = null;
let selectFallback: unknown[] = [];
let insertError: Error | null = null;
const inserted: { table: string; values: Record<string, unknown> }[] = [];
const deleted: string[] = [];
const whereClauses: string[] = [];

function describeSql(condition: unknown): string {
  const chunks = (condition as { queryChunks?: unknown[] })?.queryChunks;
  if (!Array.isArray(chunks)) return '';
  return chunks
    .map((chunk) => {
      if (!chunk || typeof chunk !== 'object' || !('value' in chunk)) return '';
      const value = (chunk as { value: unknown }).value;
      if (Array.isArray(value)) return value.join('');
      return typeof value === 'string' ? value : '';
    })
    .join('');
}

const PLATFORM_FLEET_ID = '44444444-4444-4444-8444-444444444444';
const mockFindFleetByName = jest.fn();

jest.mock('../src/repositories/organization.repository', () => ({
  ...jest.requireActual('../src/repositories/organization.repository'),
  findFleetByName: (...args: unknown[]) => mockFindFleetByName(...args),
}));

jest.mock('../src/db/connection', () => {
  const insert = (table: unknown) => ({
    values: (values: Record<string, unknown>) => {
      const record = () => {
        inserted.push({ table: nameOf(table), values });
        if (insertError) throw insertError;
      };
      return {
        returning: async () => {
          record();
          return [
            {
              id: '11111111-1111-4111-8111-111111111111',
              ...values,
            },
          ];
        },
        onConflictDoNothing: async () => {
          record();
        },
      };
    },
  });
  const db = {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ insert }),
    insert,
    select: () => ({
      from: () => ({
        where: (condition: unknown) => {
          whereClauses.push(describeSql(condition));
          return {
            limit: async () => {
              if (selectQueue && selectQueue.length > 0) return selectQueue.shift();
              return selectFallback;
            },
          };
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: async () => {
        const tableName = nameOf(table);
        deleted.push(tableName);
      },
    }),
  };
  return { db };
});

jest.mock('../src/services/auth0Management', () => ({
  auth0Management: {
    isConfigured: () => mockIsConfigured(),
    findUserByEmail: (...args: unknown[]) => mockFindUserByEmail(...args),
    createUser: (...args: unknown[]) => mockCreateUser(...args),
    sendPasswordResetEmail: (...args: unknown[]) => mockSendReset(...args),
    deleteUser: (...args: unknown[]) => mockDeleteUser(...args),
  },
}));

jest.mock('../src/services/driverQrCode.service', () => ({
  generateUniqueDriverQrCode: () => mockQr(),
}));

jest.mock('../src/services/vehicleQrCode.service', () => ({
  ensureDriverVehicleQrCode: (...args: unknown[]) => mockVehicleQr(...args),
}));

jest.mock('../src/config/redis', () => ({
  realtimeCache: {
    setDriverStatus: jest.fn(),
    getDriverStatus: jest.fn(),
  },
  redisPub: { publish: jest.fn() },
  PubSubChannels: {},
}));

const PASSWORD = 'ExamplePassword123!';

const validBody = {
  name: '  Amina Rahman  ',
  email: 'Amina@Example.com',
  phone: '  +8801712345678  ',
  password: PASSWORD,
  confirmPassword: PASSWORD,
};

describe('POST /api/v1/driver/auth/register', () => {
  let app: express.Express;

  beforeAll(async () => {
    const { getTableName } = await import('drizzle-orm');
    nameOf = (table: unknown) => getTableName(table as never);
    const routes = (await import('../src/routes/v1/driver/auth')).default;
    app = express();
    app.use(express.json());
    app.use('/api/v1/driver/auth', routes);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    selectQueue = null;
    selectFallback = [];
    insertError = null;
    inserted.length = 0;
    deleted.length = 0;
    whereClauses.length = 0;
    mockIsConfigured.mockReturnValue(true);
    mockFindUserByEmail.mockResolvedValue(null);
    mockCreateUser.mockImplementation(async (data: { email: string; name: string }) => ({
      user_id: 'auth0|new-driver',
      email: data.email,
      name: data.name,
    }));
    mockSendReset.mockResolvedValue({ delivered: true, detail: 'sent' });
    mockDeleteUser.mockResolvedValue(undefined);
    mockQr.mockResolvedValue('QR-DRIVER-1');
    mockVehicleQr.mockResolvedValue('VQR-DRIVER-1');
    mockFindFleetByName.mockResolvedValue({ id: PLATFORM_FLEET_ID, name: 'Platform Fleet' });
  });

  it('registers with name, email, phone, and password, then asks the driver to log in', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const res = await request(app).post('/api/v1/driver/auth/register').send(validBody);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      success: true,
      data: {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Amina Rahman',
        email: 'amina@example.com',
        phone: '+8801712345678',
        accountStatus: 'active',
        status: 'offline',
        nextStep: 'login',
      },
    });
    expect(res.body.data).not.toHaveProperty('token');
    expect(res.body.data).not.toHaveProperty('password');
    expect(res.body.data).not.toHaveProperty('confirmPassword');
    expect(JSON.stringify(res.body)).not.toContain(PASSWORD);

    expect(mockCreateUser).toHaveBeenCalledTimes(1);
    const created = mockCreateUser.mock.calls[0][0];
    expect(created).toEqual({
      email: 'amina@example.com',
      name: 'Amina Rahman',
      role: 'driver',
      password: PASSWORD,
    });
    expect(created).not.toHaveProperty('confirmPassword');
    expect(JSON.stringify(log.mock.calls)).not.toContain(PASSWORD);
    expect(JSON.stringify(err.mock.calls)).not.toContain(PASSWORD);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(PASSWORD);

    expect(mockSendReset).not.toHaveBeenCalled();
    expect(mockDeleteUser).not.toHaveBeenCalled();
    expect(mockVehicleQr).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');

    expect(inserted).toHaveLength(2);
    expect(inserted[1]).toEqual({
      table: 'driver_fleet_memberships',
      values: {
        driverId: '11111111-1111-4111-8111-111111111111',
        fleetId: PLATFORM_FLEET_ID,
        status: 'active',
      },
    });
    expect(mockFindFleetByName).toHaveBeenCalledWith('Platform Fleet');
    expect(inserted[0].table).toBe('drivers');
    expect(inserted[0].values).toMatchObject({
      auth0Id: 'auth0|new-driver',
      email: 'amina@example.com',
      name: 'Amina Rahman',
      phone: '+8801712345678',
      status: 'offline',
      accountStatus: 'active',
      qrCode: 'QR-DRIVER-1',
    });
    expect(inserted[0].values).not.toHaveProperty('password');
    expect(inserted[0].values).not.toHaveProperty('confirmPassword');
    expect(inserted[0].values).not.toHaveProperty('vehicleId');
    expect(inserted[0].values).not.toHaveProperty('vehicleType');
    expect(inserted[0].values).not.toHaveProperty('cabNumber');
    expect(inserted[0].values).not.toHaveProperty('cabName');
    expect(inserted[0].values).not.toHaveProperty('vehicleMake');
    expect(whereClauses.some((clause) => clause.includes('lower'))).toBe(true);
    expect(whereClauses.some((clause) => clause.includes('trim'))).toBe(true);

    log.mockRestore();
    err.mockRestore();
    warn.mockRestore();
  });

  it('rejects a missing password before calling Auth0', async () => {
    const { password: _password, ...withoutPassword } = validBody;
    const res = await request(app).post('/api/v1/driver/auth/register').send(withoutPassword);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(res.body)).not.toContain(PASSWORD);
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it('rejects a missing confirmPassword before calling Auth0', async () => {
    const { confirmPassword: _confirmPassword, ...withoutConfirm } = validBody;
    const res = await request(app).post('/api/v1/driver/auth/register').send(withoutConfirm);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it('rejects mismatched passwords before calling Auth0', async () => {
    const res = await request(app)
      .post('/api/v1/driver/auth/register')
      .send({ ...validBody, confirmPassword: 'ExamplePassword123?' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(res.body)).not.toContain(PASSWORD);
    expect(JSON.stringify(res.body)).not.toContain('ExamplePassword123?');
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it('rejects a password shorter than 8 characters before calling Auth0', async () => {
    const res = await request(app)
      .post('/api/v1/driver/auth/register')
      .send({ ...validBody, password: 'short1!', confirmPassword: 'short1!' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('short1!');
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it.each([
    ['role', { role: 'admin' }],
    ['vehicleId', { vehicleId: '11111111-1111-4111-8111-111111111111' }],
    ['serviceCategoryId', { serviceCategoryId: '22222222-2222-4222-8222-222222222222' }],
    ['fleetId', { fleetId: '33333333-3333-4333-8333-333333333333' }],
    ['cabNumber', { cabNumber: 'CAB-9' }],
  ])('rejects unknown field %s', async (_label, extra) => {
    const res = await request(app)
      .post('/api/v1/driver/auth/register')
      .send({ ...validBody, ...extra });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it('rejects a duplicate driver email', async () => {
    selectQueue = [[{ id: 'existing-driver' }]];
    const res = await request(app).post('/api/v1/driver/auth/register').send(validBody);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE_EMAIL');
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it('rejects a mixed-case duplicate of an existing driver email', async () => {
    selectQueue = [[{ id: 'existing-driver' }]];
    const res = await request(app)
      .post('/api/v1/driver/auth/register')
      .send({ ...validBody, email: 'AMINA@example.com' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE_EMAIL');
    expect(mockCreateUser).not.toHaveBeenCalled();
    expect(whereClauses[0]).toContain('lower');
  });

  it('rejects an admin email collision', async () => {
    selectQueue = [[], [{ id: 'admin-1' }]];
    const res = await request(app).post('/api/v1/driver/auth/register').send(validBody);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE_EMAIL');
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it('rejects a passenger email collision', async () => {
    selectQueue = [[], [], [{ id: 'customer-1' }]];
    const res = await request(app).post('/api/v1/driver/auth/register').send(validBody);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE_EMAIL');
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it('rejects an existing Auth0 email without attaching that identity', async () => {
    mockFindUserByEmail.mockResolvedValue({ user_id: 'auth0|passenger-existing' });
    const res = await request(app).post('/api/v1/driver/auth/register').send(validBody);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE_EMAIL');
    expect(mockCreateUser).not.toHaveBeenCalled();
    expect(mockDeleteUser).not.toHaveBeenCalled();
    expect(inserted).toHaveLength(0);
  });

  it('rejects a duplicate driver phone', async () => {
    selectQueue = [[], [], [], [{ id: 'other-driver' }]];
    const res = await request(app).post('/api/v1/driver/auth/register').send(validBody);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE_PHONE');
    expect(mockCreateUser).not.toHaveBeenCalled();
    expect(whereClauses.some((clause) => clause.includes('trim'))).toBe(true);
  });

  it('returns 503 when Auth0 management is not configured', async () => {
    mockIsConfigured.mockReturnValue(false);
    const res = await request(app).post('/api/v1/driver/auth/register').send(validBody);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('AUTH0_NOT_CONFIGURED');
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it('fails before creating an Auth0 user when Platform Fleet cannot be resolved', async () => {
    const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockFindFleetByName.mockRejectedValue(new Error('db down'));
    const res = await request(app).post('/api/v1/driver/auth/register').send(validBody);
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('REGISTRATION_FAILED');
    expect(mockCreateUser).not.toHaveBeenCalled();
    expect(inserted).toHaveLength(0);
    err.mockRestore();
  });

  it('rolls back the Auth0 user when driver insert fails', async () => {
    insertError = new Error('insert failed');
    const res = await request(app).post('/api/v1/driver/auth/register').send(validBody);
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('REGISTRATION_FAILED');
    expect(mockDeleteUser).toHaveBeenCalledWith('auth0|new-driver');
    expect(mockSendReset).not.toHaveBeenCalled();
    expect(mockVehicleQr).not.toHaveBeenCalled();
    expect(JSON.stringify(res.body)).not.toContain(PASSWORD);
  });
});

describe('registration does not change login or duty gates', () => {
  const authSrc = fs.readFileSync(path.join(__dirname, '../src/routes/auth.ts'), 'utf8');
  const dutySrc = fs.readFileSync(path.join(__dirname, '../src/services/duty.service.ts'), 'utf8');
  const registrationSrc = fs.readFileSync(
    path.join(__dirname, '../src/services/driverRegistration.service.ts'),
    'utf8'
  );

  it('leaves POST /api/auth/login requiring a pre-existing driver row', () => {
    expect(authSrc).toContain("return sendError(res, 'NOT_FOUND', 'User not found in database', 404)");
    expect(authSrc).toContain('driverUtils.findByAuth0Id(auth0Id)');
    expect(authSrc).not.toContain('driverRegistration');
    expect(authSrc).not.toContain('registerDriver');
  });

  it('writes only the Platform Fleet membership, not assignment or category tables', () => {
    expect(registrationSrc).toContain('insertDriverWithFleetMembership');
    expect(registrationSrc).toContain('resolvePlatformFleetId');
    expect(registrationSrc).not.toContain('driverVehicleAssignments');
    expect(registrationSrc).not.toContain('driverServiceCategories');
    expect(registrationSrc).not.toContain('vehicleServiceCategories');
    expect(registrationSrc).not.toContain('vehicleId');
    expect(registrationSrc).not.toContain('sendPasswordResetEmail');
    expect(registrationSrc).not.toContain('generateTemporaryPassword');
    expect(registrationSrc).not.toContain('PASSWORD_RESET_EMAIL_FAILED');
    expect(dutySrc).toContain(
      "throw new DutyError('FLEET_MISMATCH', 'Driver has no active fleet membership', 403)"
    );
  });

  it('still rejects duty start with FLEET_MISMATCH when the driver has no fleet membership', async () => {
    inserted.length = 0;
    deleted.length = 0;
    selectQueue = [[{ id: 'driver-1', accountStatus: 'active' }], []];
    const { startDuty } = await import('../src/services/duty.service');
    await expect(
      startDuty({
        driverId: 'driver-1',
        vehicleQrToken: 'VQR_test_token',
      })
    ).rejects.toMatchObject({
      code: 'FLEET_MISMATCH',
      statusCode: 403,
    });
    expect(inserted).toHaveLength(0);
  });
});
