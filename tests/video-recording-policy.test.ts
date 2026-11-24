/**
 * Global video recording policy — Admin/Driver routes, service rules, and
 * Socket.IO delivery. Persistence is an in-memory stand-in for
 * platform_settings; see video-recording-policy.db.test.ts for real PostgreSQL.
 */
import fs from 'fs';
import path from 'path';
import http from 'http';
import type { AddressInfo } from 'net';
import express from 'express';
import request from 'supertest';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';

const DRIVER_ID = '22222222-2222-4222-8222-222222222222';
const DRIVER_AUTH0 = 'auth0|driver-1';

const authState: {
  enabled: boolean;
  role: string;
  permissions?: string[];
  auth0Id: string;
  email?: string;
} = { enabled: true, role: 'super_admin', auth0Id: 'auth0|super-1', email: 'ops@example.com' };

jest.mock('../src/middleware/auth', () => ({
  requireAuth: (_req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!authState.enabled) {
      res.status(401).json({
        success: false,
        error: { code: 'AUTH_FAILED', message: 'No token provided' },
      });
      return;
    }
    next();
  },
  extractUserInfo: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { user?: Record<string, unknown> }).user = {
      auth0Id: authState.auth0Id,
      email: authState.email,
      role: authState.role,
      permissions: authState.permissions,
    };
    next();
  },
}));

jest.mock('../src/middleware/device-tracking', () => ({
  trackDriverDevice: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const videoConfigState = {
  enabled: true,
  consentRequired: true,
  segmentDurationSeconds: 10,
  maxSegmentSizeBytes: 1_000_000,
  uploadUrlTtlSeconds: 300,
  readUrlTtlSeconds: 120,
  retentionDays: 30,
  storageContainer: 'ride-recordings',
  storageRoot: '/tmp/ride-video-policy-tests',
  apiPublicBaseUrl: '',
  allowedMimeTypes: new Set(['video/mp4', 'video/quicktime']),
};
jest.mock('../src/config/video', () => ({ videoConfig: videoConfigState }));

jest.mock('../src/config/redis', () => ({
  redisPub: {},
  redisSub: { subscribe: jest.fn(), on: jest.fn() },
  isRedisPubSubEnabled: () => false,
  safeRedisPublish: jest.fn(),
  PubSubChannels: { BOOKING_UPDATE: 'booking:update' },
}));

const mockFindDriver = jest.fn();
jest.mock('../src/db/connection', () => ({
  db: { query: { drivers: { findFirst: (...args: unknown[]) => mockFindDriver(...args) } } },
}));

jest.mock('../src/db/utils', () => ({
  adminUtils: {
    findByAuth0Id: jest.fn(async (auth0Id: string) =>
      auth0Id === 'auth0|super-1' ? { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } : null
    ),
  },
  driverUtils: { findByAuth0Id: jest.fn() },
}));

jest.mock('../src/middleware/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const mockVerifyBearerToken = jest.fn();
jest.mock('../src/utils/jwt-verifier', () => ({
  verifyBearerToken: (...args: unknown[]) => mockVerifyBearerToken(...args),
}));

for (const handler of ['authentication', 'location', 'driver-status', 'booking', 'connection']) {
  const fn = `setup${handler
    .split('-')
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join('')}Handler`;
  jest.doMock(`../src/websocket/handlers/${handler}`, () => ({ [fn]: jest.fn() }));
}

/** In-memory platform_settings row + audit trail (same contract as the repository). */
const store: {
  row: {
    id: number;
    videoRecordingEnabled: boolean;
    version: number;
    updatedByAdminUserId: string | null;
    updatedByAuth0Id: string | null;
    updatedByEmail: string | null;
    createdAt: Date;
    updatedAt: Date;
  } | null;
  audit: Array<Record<string, unknown>>;
  failReads: boolean;
  failWrites: boolean;
  events: string[];
} = { row: null, audit: [], failReads: false, failWrites: false, events: [] };

function seedDefaultRow() {
  store.row = {
    id: 1,
    videoRecordingEnabled: false,
    version: 1,
    updatedByAdminUserId: null,
    updatedByAuth0Id: null,
    updatedByEmail: null,
    createdAt: new Date('2026-11-23T00:00:00.000Z'),
    updatedAt: new Date('2026-11-23T00:00:00.000Z'),
  };
}

jest.mock('../src/repositories/platformSettings.repository', () => ({
  findPlatformSettings: jest.fn(async () => {
    if (store.failReads) throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    return store.row ? { ...store.row } : null;
  }),
  setVideoRecordingEnabledWithAudit: jest.fn(
    async (input: {
      enabled: boolean;
      expectedVersion?: number;
      actor: { adminUserId: string | null; auth0Id: string | null; email: string | null };
    }) => {
      if (store.failWrites) throw new Error('connect ECONNREFUSED');
      if (!store.row) seedDefaultRow();
      const current = { ...store.row! };
      if (input.expectedVersion !== undefined && input.expectedVersion !== current.version) {
        return { outcome: 'version_conflict', row: current };
      }
      if (current.videoRecordingEnabled === input.enabled) {
        return { outcome: 'unchanged', row: current };
      }
      store.row = {
        ...current,
        videoRecordingEnabled: input.enabled,
        version: current.version + 1,
        updatedByAdminUserId: input.actor.adminUserId,
        updatedByAuth0Id: input.actor.auth0Id,
        updatedByEmail: input.actor.email,
        updatedAt: new Date(current.updatedAt.getTime() + 60_000),
      };
      store.audit.push({
        adminUserId: input.actor.adminUserId,
        adminEmail: input.actor.email,
        previousValue: current.videoRecordingEnabled,
        newValue: input.enabled,
        newVersion: store.row.version,
      });
      store.events.push('persisted');
      return { outcome: 'updated', previous: current, row: { ...store.row } };
    }
  ),
  listRecordingPolicyAuditEvents: jest.fn(),
}));

import { errorHandler } from '../src/middleware/error-handler';
import adminSettingsRoutes from '../src/routes/v1/admin/settings';
import driverVideoRoutes from '../src/routes/v1/driver/video';
import * as bookingNotify from '../src/services/bookingNotify.service';
import {
  VIDEO_RECORDING_CONFIG_UPDATED_EVENT,
  getDriverVideoRecordingConfig,
  syncVideoRecordingConfigToSocket,
  updateVideoRecordingConfig,
} from '../src/services/videoRecordingPolicy.service';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/admin/settings', adminSettingsRoutes);
  app.use('/api/v1/driver/video', driverVideoRoutes);
  app.use(errorHandler);
  return app;
}

function asSuperAdmin() {
  authState.enabled = true;
  authState.role = 'super_admin';
  authState.permissions = undefined;
  authState.auth0Id = 'auth0|super-1';
  authState.email = 'ops@example.com';
}

function asDriver() {
  authState.enabled = true;
  authState.role = 'driver';
  authState.permissions = undefined;
  authState.auth0Id = DRIVER_AUTH0;
  authState.email = undefined;
}

let app: express.Express;

beforeAll(() => {
  app = buildApp();
});

beforeEach(() => {
  jest.clearAllMocks();
  seedDefaultRow();
  store.audit = [];
  store.events = [];
  store.failReads = false;
  store.failWrites = false;
  videoConfigState.enabled = true;
  asSuperAdmin();
});

afterEach(() => {
  jest.spyOn(bookingNotify, 'emitToAllDrivers').mockRestore();
  jest.spyOn(bookingNotify, 'emitToAdmins').mockRestore();
});

describe('route mounting', () => {
  it('mounts admin settings and driver video routers on /api/v1', () => {
    const src = fs.readFileSync(path.join(__dirname, '../src/routes/v1/index.ts'), 'utf8');
    expect(src).toContain("router.use('/admin/settings', adminSettingsRoutes)");
    expect(src).toContain("router.use('/driver/video', driverVideoRoutes)");
  });

  it('keeps existing driver video session routes mounted alongside recording-config', () => {
    const stack = (driverVideoRoutes as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack
      .filter((layer) => layer.route)
      .map((layer) => `${Object.keys(layer.route!.methods)[0].toUpperCase()} ${layer.route!.path}`);
    expect(stack).toEqual(
      expect.arrayContaining([
        'GET /recording-config',
        'POST /sessions/:sessionId/segments',
        'PUT /segments/:segmentId/upload',
        'POST /sessions/:sessionId/segments/:segmentId/complete',
        'POST /sessions/:sessionId/segments/:segmentId/failed',
        'GET /sessions/:sessionId/segments',
        'POST /sessions/:sessionId/pause',
        'POST /sessions/:sessionId/resume',
        'POST /sessions/:sessionId/finalize',
      ])
    );
  });
});

describe('GET /api/v1/admin/settings/video-recording', () => {
  it('returns default OFF on a fresh installation', async () => {
    const res = await request(app).get('/api/v1/admin/settings/video-recording');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: {
        enabled: false,
        effectiveEnabled: false,
        serverRecordingAvailable: true,
        version: 1,
        updatedAt: '2026-11-23T00:00:00.000Z',
        updatedBy: null,
      },
    });
  });

  it('reports OFF when the row is missing', async () => {
    store.row = null;
    const res = await request(app).get('/api/v1/admin/settings/video-recording');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ enabled: false, effectiveEnabled: false, version: 0 });
  });

  it('allows a regular admin to read (ride_video.view)', async () => {
    authState.role = 'admin';
    const res = await request(app).get('/api/v1/admin/settings/video-recording');
    expect(res.status).toBe(200);
  });

  it('rejects unauthenticated, driver and customer callers', async () => {
    authState.enabled = false;
    expect((await request(app).get('/api/v1/admin/settings/video-recording')).status).toBe(401);
    asDriver();
    expect((await request(app).get('/api/v1/admin/settings/video-recording')).status).toBe(403);
    authState.role = 'customer';
    expect((await request(app).get('/api/v1/admin/settings/video-recording')).status).toBe(403);
  });

  it('returns 503 VIDEO_RECORDING_POLICY_UNAVAILABLE when PostgreSQL cannot be read', async () => {
    store.failReads = true;
    const res = await request(app).get('/api/v1/admin/settings/video-recording');
    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VIDEO_RECORDING_POLICY_UNAVAILABLE');
    expect(JSON.stringify(res.body)).not.toContain('ECONNREFUSED');
  });

  it('shows the pipeline as unavailable while keeping the saved preference', async () => {
    videoConfigState.enabled = false;
    store.row!.videoRecordingEnabled = true;
    const res = await request(app).get('/api/v1/admin/settings/video-recording');
    expect(res.body.data).toMatchObject({
      enabled: true,
      effectiveEnabled: false,
      serverRecordingAvailable: false,
    });
  });
});

describe('PATCH /api/v1/admin/settings/video-recording', () => {
  it('lets a super_admin enable and then disable, bumping the version and auditing each change', async () => {
    const on = await request(app)
      .patch('/api/v1/admin/settings/video-recording')
      .send({ enabled: true, expectedVersion: 1 });
    expect(on.status).toBe(200);
    expect(on.body.data).toMatchObject({
      enabled: true,
      effectiveEnabled: true,
      version: 2,
      changed: true,
      updatedBy: { email: 'ops@example.com' },
    });

    const off = await request(app)
      .patch('/api/v1/admin/settings/video-recording')
      .send({ enabled: false });
    expect(off.status).toBe(200);
    expect(off.body.data).toMatchObject({ enabled: false, effectiveEnabled: false, version: 3 });

    expect(store.audit).toEqual([
      expect.objectContaining({
        adminUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        adminEmail: 'ops@example.com',
        previousValue: false,
        newValue: true,
        newVersion: 2,
      }),
      expect.objectContaining({ previousValue: true, newValue: false, newVersion: 3 }),
    ]);
  });

  it('returns changed=false and does not audit or notify when the value is unchanged', async () => {
    const spy = jest.spyOn(bookingNotify, 'emitToAllDrivers');
    const res = await request(app)
      .patch('/api/v1/admin/settings/video-recording')
      .send({ enabled: false });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ enabled: false, version: 1, changed: false });
    expect(store.audit).toHaveLength(0);
    expect(spy).not.toHaveBeenCalled();
  });

  it('rejects a regular admin without ride_video.manage (403) and never writes', async () => {
    authState.role = 'admin';
    const res = await request(app)
      .patch('/api/v1/admin/settings/video-recording')
      .send({ enabled: true });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('MISSING_PERMISSION');
    expect(store.row!.videoRecordingEnabled).toBe(false);
  });

  it('accepts an admin whose token carries the explicit ride_video.manage permission', async () => {
    authState.role = 'admin';
    authState.permissions = ['ride_video.view', 'ride_video.manage'];
    const res = await request(app)
      .patch('/api/v1/admin/settings/video-recording')
      .send({ enabled: true });
    expect(res.status).toBe(200);
    expect(res.body.data.enabled).toBe(true);
  });

  it('rejects super_admin tokens whose explicit ride_video scopes omit manage', async () => {
    authState.permissions = ['ride_video.view'];
    const res = await request(app)
      .patch('/api/v1/admin/settings/video-recording')
      .send({ enabled: true });
    expect(res.status).toBe(403);
  });

  it('rejects unauthenticated and driver callers', async () => {
    authState.enabled = false;
    expect(
      (await request(app).patch('/api/v1/admin/settings/video-recording').send({ enabled: true }))
        .status
    ).toBe(401);
    asDriver();
    expect(
      (await request(app).patch('/api/v1/admin/settings/video-recording').send({ enabled: true }))
        .status
    ).toBe(403);
    expect(store.row!.videoRecordingEnabled).toBe(false);
  });

  it.each([
    ['string "true"', { enabled: 'true' }],
    ['number 1', { enabled: 1 }],
    ['null', { enabled: null }],
    ['missing enabled', {}],
    ['unknown field', { enabled: true, force: true }],
    ['negative expectedVersion', { enabled: true, expectedVersion: -1 }],
    ['fractional expectedVersion', { enabled: true, expectedVersion: 1.5 }],
  ])('rejects invalid body (%s) with 400', async (_label, body) => {
    const res = await request(app).patch('/api/v1/admin/settings/video-recording').send(body);
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(store.row!.videoRecordingEnabled).toBe(false);
    expect(store.row!.version).toBe(1);
  });

  it('returns 409 on a stale expectedVersion and leaves the setting untouched', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/settings/video-recording')
      .send({ enabled: true, expectedVersion: 7 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('VIDEO_RECORDING_POLICY_VERSION_CONFLICT');
    expect(store.row).toMatchObject({ videoRecordingEnabled: false, version: 1 });
    expect(store.audit).toHaveLength(0);
  });

  it('applies concurrent updates one at a time (second stale writer gets 409)', async () => {
    const [a, b] = await Promise.all([
      updateVideoRecordingConfig({ enabled: true, expectedVersion: 1, actor: {} }),
      updateVideoRecordingConfig({ enabled: true, expectedVersion: 1, actor: {} }).catch(
        (error) => error
      ),
    ]);
    expect(a).toMatchObject({ enabled: true, version: 2, changed: true });
    expect(b).toMatchObject({ code: 'VIDEO_RECORDING_POLICY_VERSION_CONFLICT', statusCode: 409 });
    expect(store.audit).toHaveLength(1);
  });

  it('returns 503 when the write cannot be persisted and does not notify drivers', async () => {
    store.failWrites = true;
    const spy = jest.spyOn(bookingNotify, 'emitToAllDrivers');
    const res = await request(app)
      .patch('/api/v1/admin/settings/video-recording')
      .send({ enabled: true });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('VIDEO_RECORDING_POLICY_UNAVAILABLE');
    expect(spy).not.toHaveBeenCalled();
  });

  it('keeps the persisted change when the socket notification fails', async () => {
    jest.spyOn(bookingNotify, 'emitToAllDrivers').mockRejectedValueOnce(new Error('socket down'));
    const res = await request(app)
      .patch('/api/v1/admin/settings/video-recording')
      .send({ enabled: true });
    expect(res.status).toBe(200);
    expect(store.row!.videoRecordingEnabled).toBe(true);
  });
});

describe('GET /api/v1/driver/video/recording-config', () => {
  beforeEach(() => asDriver());

  it('returns the effective policy in the standard envelope (default OFF)', async () => {
    const res = await request(app).get('/api/v1/driver/video/recording-config');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({
      success: true,
      data: { enabled: false, version: 1, updatedAt: '2026-11-23T00:00:00.000Z' },
    });
  });

  it('reflects the latest persisted Admin change', async () => {
    await updateVideoRecordingConfig({ enabled: true, actor: {} });
    const res = await request(app).get('/api/v1/driver/video/recording-config');
    expect(res.body.data).toEqual({
      enabled: true,
      version: 2,
      updatedAt: '2026-11-23T00:01:00.000Z',
    });
  });

  it('reports enabled=false when the server pipeline is unavailable even if Admin saved ON', async () => {
    store.row!.videoRecordingEnabled = true;
    videoConfigState.enabled = false;
    const res = await request(app).get('/api/v1/driver/video/recording-config');
    expect(res.body.data.enabled).toBe(false);
  });

  it('fails closed: missing row → enabled=false, version 0, updatedAt null', async () => {
    store.row = null;
    const res = await request(app).get('/api/v1/driver/video/recording-config');
    expect(res.body.data).toEqual({ enabled: false, version: 0, updatedAt: null });
  });

  it('fails closed: non-boolean stored value → enabled=false', async () => {
    (store.row as unknown as { videoRecordingEnabled: unknown }).videoRecordingEnabled = 'true';
    const res = await request(app).get('/api/v1/driver/video/recording-config');
    expect(res.body.data.enabled).toBe(false);
  });

  it('returns 503 VIDEO_RECORDING_POLICY_UNAVAILABLE on a database failure', async () => {
    store.failReads = true;
    const res = await request(app).get('/api/v1/driver/video/recording-config');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('VIDEO_RECORDING_POLICY_UNAVAILABLE');
  });

  it('rejects unauthenticated, customer and admin callers', async () => {
    authState.enabled = false;
    expect((await request(app).get('/api/v1/driver/video/recording-config')).status).toBe(401);
    authState.enabled = true;
    authState.role = 'customer';
    expect((await request(app).get('/api/v1/driver/video/recording-config')).status).toBe(403);
    authState.role = 'admin';
    expect((await request(app).get('/api/v1/driver/video/recording-config')).status).toBe(403);
  });
});

describe('notification after persistence', () => {
  it('broadcasts to all drivers and admins only after the row is persisted', async () => {
    const order: string[] = [];
    jest.spyOn(bookingNotify, 'emitToAllDrivers').mockImplementation(async (event, data) => {
      order.push(`drivers:${event}:${store.row!.videoRecordingEnabled}`);
      expect(data).toEqual({
        enabled: true,
        version: 2,
        updatedAt: '2026-11-23T00:01:00.000Z',
        reason: 'admin_update',
      });
    });
    jest.spyOn(bookingNotify, 'emitToAdmins').mockImplementation(async (event, data) => {
      order.push(`admin:${event}`);
      expect(data).toMatchObject({ enabled: true, effectiveEnabled: true, reason: 'admin_update' });
    });

    await updateVideoRecordingConfig({ enabled: true, actor: {} });

    expect(store.events).toEqual(['persisted']);
    expect(order).toEqual([
      `drivers:${VIDEO_RECORDING_CONFIG_UPDATED_EVENT}:true`,
      `admin:${VIDEO_RECORDING_CONFIG_UPDATED_EVENT}`,
    ]);
  });

  it('a backend restart reads the persisted value (no in-memory cache)', async () => {
    await updateVideoRecordingConfig({ enabled: true, actor: {} });
    let fresh: typeof import('../src/services/videoRecordingPolicy.service') | undefined;
    jest.isolateModules(() => {
      fresh = jest.requireActual<typeof import('../src/services/videoRecordingPolicy.service')>(
        '../src/services/videoRecordingPolicy.service'
      );
    });
    await expect(fresh!.getDriverVideoRecordingConfig()).resolves.toMatchObject({
      enabled: true,
      version: 2,
    });
    await expect(getDriverVideoRecordingConfig()).resolves.toMatchObject({ enabled: true });
  });
});

describe('connection_sync helper', () => {
  it('emits the latest persisted policy with reason connection_sync', async () => {
    const socket = { emit: jest.fn() };
    await expect(syncVideoRecordingConfigToSocket(socket)).resolves.toBe(true);
    expect(socket.emit).toHaveBeenCalledWith(VIDEO_RECORDING_CONFIG_UPDATED_EVENT, {
      enabled: false,
      version: 1,
      updatedAt: '2026-11-23T00:00:00.000Z',
      reason: 'connection_sync',
    });
  });

  it('emits nothing when PostgreSQL is unavailable (REST returns 503, gates stay closed)', async () => {
    store.failReads = true;
    const socket = { emit: jest.fn() };
    await expect(syncVideoRecordingConfigToSocket(socket)).resolves.toBe(false);
    expect(socket.emit).not.toHaveBeenCalled();
  });
});

describe('Socket.IO delivery (real server + client)', () => {
  let httpServer: http.Server;
  let ioServer: import('socket.io').Server;
  let url: string;
  const clients: ClientSocket[] = [];

  beforeAll(async () => {
    process.env.CORS_ORIGIN = 'http://localhost';
    const realSetInterval = global.setInterval;
    const intervalSpy = jest
      .spyOn(global, 'setInterval')
      .mockImplementation(((fn: () => void, ms?: number) => {
        const timer = realSetInterval(fn, ms);
        timer.unref();
        return timer;
      }) as typeof setInterval);
    const { setupWebSocketServer } = await import('../src/websocket/server');
    httpServer = http.createServer();
    ioServer = setupWebSocketServer(httpServer);
    intervalSpy.mockRestore();
    bookingNotify.setupBookingEventSubscriber(ioServer);
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  });

  afterEach(() => {
    while (clients.length) clients.pop()!.disconnect();
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => ioServer.close(() => resolve()));
  });

  beforeEach(() => {
    mockVerifyBearerToken.mockImplementation(async (token: string) => {
      if (token === 'driver-token') return { sub: DRIVER_AUTH0, role: 'driver', name: 'Driver One' };
      if (token === 'unknown-driver-token') return { sub: 'auth0|ghost', role: 'driver' };
      if (token === 'customer-token') return { sub: 'auth0|cust', role: 'customer' };
      return null;
    });
    mockFindDriver.mockImplementation(async () => ({ id: DRIVER_ID }));
  });

  function connect(token?: string) {
    const client = ioClient(url, {
      transports: ['websocket'],
      auth: token ? { token } : {},
      reconnection: false,
      forceNew: true,
    });
    clients.push(client);
    return client;
  }

  function nextEvent<T>(client: ClientSocket, event: string, timeoutMs = 2000): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeoutMs);
      client.once(event, (payload: T) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });
  }

  function expectNoEvent(client: ClientSocket, event: string, windowMs = 400): Promise<void> {
    return new Promise((resolve, reject) => {
      const handler = () => reject(new Error(`unexpected ${event}`));
      client.on(event, handler);
      setTimeout(() => {
        client.off(event, handler);
        resolve();
      }, windowMs);
    });
  }

  it('sends connection_sync to an authenticated driver and joins driver-{uuid} + drivers', async () => {
    const client = connect('driver-token');
    const [authenticated, sync] = await Promise.all([
      nextEvent<{ rooms: string[] }>(client, 'authenticated'),
      nextEvent(client, VIDEO_RECORDING_CONFIG_UPDATED_EVENT),
    ]);
    expect(authenticated.rooms).toEqual(
      expect.arrayContaining([`driver-${DRIVER_ID}`, bookingNotify.ALL_DRIVERS_ROOM])
    );
    expect(sync).toEqual({
      enabled: false,
      version: 1,
      updatedAt: '2026-11-23T00:00:00.000Z',
      reason: 'connection_sync',
    });
  });

  it('delivers admin_update to every connected driver after the change is persisted', async () => {
    const a = connect('driver-token');
    const b = connect('driver-token');
    await Promise.all([
      nextEvent(a, VIDEO_RECORDING_CONFIG_UPDATED_EVENT),
      nextEvent(b, VIDEO_RECORDING_CONFIG_UPDATED_EVENT),
    ]);

    const updates = Promise.all([
      nextEvent(a, VIDEO_RECORDING_CONFIG_UPDATED_EVENT),
      nextEvent(b, VIDEO_RECORDING_CONFIG_UPDATED_EVENT),
    ]);
    await updateVideoRecordingConfig({ enabled: true, actor: {} });
    const expected = {
      enabled: true,
      version: 2,
      updatedAt: '2026-11-23T00:01:00.000Z',
      reason: 'admin_update',
    };
    await expect(updates).resolves.toEqual([expected, expected]);
  });

  it('a reconnecting driver receives the latest persisted value', async () => {
    const first = connect('driver-token');
    await nextEvent(first, VIDEO_RECORDING_CONFIG_UPDATED_EVENT);
    first.disconnect();

    await updateVideoRecordingConfig({ enabled: true, actor: {} });

    const again = connect('driver-token');
    await expect(nextEvent(again, VIDEO_RECORDING_CONFIG_UPDATED_EVENT)).resolves.toEqual({
      enabled: true,
      version: 2,
      updatedAt: '2026-11-23T00:01:00.000Z',
      reason: 'connection_sync',
    });
  });

  it('rejects sockets with an invalid token', async () => {
    const client = connect('forged-token');
    await expect(nextEvent<Error>(client, 'connect_error')).resolves.toMatchObject({
      message: 'Invalid authentication token',
    });
  });

  it('does not deliver the driver event to customers or unresolved driver identities', async () => {
    const customer = connect('customer-token');
    await nextEvent(customer, 'authenticated');
    mockFindDriver.mockResolvedValueOnce(undefined);
    const ghost = connect('unknown-driver-token');
    const ghostAuth = await nextEvent<{ rooms: string[] }>(ghost, 'authenticated');
    expect(ghostAuth.rooms).not.toContain(bookingNotify.ALL_DRIVERS_ROOM);

    const silence = Promise.all([
      expectNoEvent(customer, VIDEO_RECORDING_CONFIG_UPDATED_EVENT),
      expectNoEvent(ghost, VIDEO_RECORDING_CONFIG_UPDATED_EVENT),
    ]);
    await updateVideoRecordingConfig({ enabled: true, actor: {} });
    await expect(silence).resolves.toBeDefined();
  });
});
