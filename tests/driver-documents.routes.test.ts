import express from 'express';
import request from 'supertest';

const mockList = jest.fn();
const mockGet = jest.fn();
const mockUpload = jest.fn();
const mockResolve = jest.fn();
const mockResolveSigned = jest.fn();
const mockAdminList = jest.fn();
const mockAdminGet = jest.fn();
const mockFindByAuth0Id = jest.fn();

let testRole = 'driver';
let requireAuthEnabled = true;
let testAuth0Id = 'auth0|driver-1';
const DRIVER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_DRIVER = '22222222-2222-4222-8222-222222222222';

jest.mock('../src/services/driverDocument.service', () => {
  class DriverDocumentError extends Error {
    constructor(
      public code: string,
      message: string,
      public statusCode: number = 400
    ) {
      super(message);
    }
  }
  return {
    DriverDocumentError,
    listDocumentsForDriver: (...args: unknown[]) => mockList(...args),
    getDocumentMetadataForDriver: (...args: unknown[]) => mockGet(...args),
    uploadOrReplaceDriverDocument: (...args: unknown[]) => mockUpload(...args),
    resolveDocumentFile: (...args: unknown[]) => mockResolve(...args),
    resolveSignedDriverDocumentFile: (...args: unknown[]) => mockResolveSigned(...args),
    listAdminDriverDocuments: (...args: unknown[]) => mockAdminList(...args),
    getAdminDriverDocument: (...args: unknown[]) => mockAdminGet(...args),
  };
});

jest.mock('../src/services/driver-document-storage.service', () => {
  class DriverDocumentStorageError extends Error {
    constructor(
      public code: string,
      message: string,
      public statusCode: number = 400
    ) {
      super(message);
    }
  }
  return { DriverDocumentStorageError };
});

jest.mock('../src/middleware/rate-limiters', () => ({
  driverDocumentUploadRateLimit: (
    _req: express.Request,
    _res: express.Response,
    next: express.NextFunction
  ) => next(),
  adminDriverDocumentRateLimit: (
    _req: express.Request,
    _res: express.Response,
    next: express.NextFunction
  ) => next(),
}));

jest.mock('../src/db/utils', () => ({
  driverUtils: {
    findByAuth0Id: (...args: unknown[]) => mockFindByAuth0Id(...args),
  },
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
      userId: testRole === 'driver' ? DRIVER_ID : 'admin-1',
    };
    next();
  },
  requireAdmin: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const user = (req as any).user;
    if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) {
      res.status(403).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Admin access required' },
      });
      return;
    }
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
  requireAdmin: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const user = (req as any).user;
    if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) {
      res.status(403).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Access denied. Required role(s): admin, super_admin' },
      });
      return;
    }
    next();
  },
  requireRole: (roles: string[]) => {
    return (req: express.Request, res: express.Response, next: express.NextFunction) => {
      const user = (req as any).user;
      if (!user || !roles.includes(user.role)) {
        res.status(403).json({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Access denied' },
        });
        return;
      }
      next();
    };
  },
}));

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

const licenseDto = {
  id: 'doc-1',
  documentType: 'driving_license',
  originalFilename: 'license.png',
  mimeType: 'image/png',
  sizeBytes: 70,
  uploadedAt: '2026-10-08T00:00:00.000Z',
  downloadUrl: '/api/v1/driver/documents/driving_license/content?token=abc',
  downloadUrlExpiresAt: '2026-10-08T00:05:00.000Z',
};

describe('driver document routes', () => {
  let driverApp: express.Express;
  let adminApp: express.Express;

  beforeAll(async () => {
    const driverRoutes = (await import('../src/routes/v1/driver/documents')).default;
    const adminRoutes = (await import('../src/routes/v1/admin/driverDocuments')).default;
    driverApp = express();
    driverApp.use(express.json());
    driverApp.use('/api/v1/driver/documents', driverRoutes);
    adminApp = express();
    adminApp.use(express.json());
    adminApp.use('/api/v1/admin/fleet/drivers/:driverId/documents', adminRoutes);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    requireAuthEnabled = true;
    testRole = 'driver';
    testAuth0Id = 'auth0|driver-1';
    mockFindByAuth0Id.mockResolvedValue({ id: DRIVER_ID, auth0Id: 'auth0|driver-1' });
    mockList.mockResolvedValue({ driving_license: licenseDto, insurance: null });
    mockGet.mockResolvedValue(licenseDto);
    mockUpload.mockResolvedValue(licenseDto);
    mockAdminList.mockResolvedValue({ driving_license: licenseDto, insurance: null });
    mockAdminGet.mockResolvedValue({
      ...licenseDto,
      downloadUrl: `/api/v1/admin/fleet/drivers/${DRIVER_ID}/documents/driving_license/content?token=abc`,
    });
    mockResolveSigned.mockResolvedValue({
      absolutePath: __filename,
      mimeType: 'text/plain',
      originalFilename: 'license.png',
    });
    mockResolve.mockResolvedValue({
      absolutePath: __filename,
      mimeType: 'text/plain',
      originalFilename: 'license.png',
    });
  });

  it('lists the authenticated driver documents and ignores any client driverId', async () => {
    const res = await request(driverApp)
      .get('/api/v1/driver/documents')
      .query({ driverId: OTHER_DRIVER });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockList).toHaveBeenCalledWith(DRIVER_ID, 'driver');
    expect(mockFindByAuth0Id).toHaveBeenCalledWith('auth0|driver-1');
  });

  it('uploads and replaces using JWT driver identity', async () => {
    const res = await request(driverApp)
      .put('/api/v1/driver/documents/driving_license')
      .attach('file', PNG_1x1, { filename: 'license.png', contentType: 'image/png' });
    expect(res.status).toBe(200);
    expect(mockUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        driverId: DRIVER_ID,
        documentType: 'driving_license',
        declaredMime: 'image/png',
        originalFilename: 'license.png',
      })
    );
  });

  it('rejects unsupported document types in the path', async () => {
    const res = await request(driverApp).get('/api/v1/driver/documents/passport');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('rejects invalid MIME uploads before service write', async () => {
    const res = await request(driverApp)
      .put('/api/v1/driver/documents/insurance')
      .attach('file', Buffer.from('hello'), { filename: 'notes.txt', contentType: 'text/plain' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_DOCUMENT_TYPE');
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('requires driver authentication', async () => {
    requireAuthEnabled = false;
    const res = await request(driverApp).get('/api/v1/driver/documents');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_FAILED');
  });

  it('streams a signed driver document URL without a JWT', async () => {
    requireAuthEnabled = false;
    const res = await request(driverApp).get(
      '/api/v1/driver/documents/insurance/content?token=signed-token'
    );
    expect(res.status).toBe(200);
    expect(mockResolveSigned).toHaveBeenCalledWith({
      documentType: 'insurance',
      token: 'signed-token',
    });
    expect(mockFindByAuth0Id).not.toHaveBeenCalled();
  });

  it('rejects document content with no JWT and no signed token', async () => {
    requireAuthEnabled = false;
    const res = await request(driverApp).get('/api/v1/driver/documents/insurance/content');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_FAILED');
    expect(mockResolveSigned).not.toHaveBeenCalled();
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it('still requires JWT for document metadata and upload', async () => {
    requireAuthEnabled = false;
    const metadata = await request(driverApp).get('/api/v1/driver/documents/insurance');
    expect(metadata.status).toBe(401);
    expect(metadata.body.error.code).toBe('AUTH_FAILED');
    const upload = await request(driverApp)
      .put('/api/v1/driver/documents/insurance')
      .attach('file', PNG_1x1, { filename: 'card.png', contentType: 'image/png' });
    expect(upload.status).toBe(401);
    expect(upload.body.error.code).toBe('AUTH_FAILED');
    expect(mockGet).not.toHaveBeenCalled();
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('streams the authenticated driver document', async () => {
    const res = await request(driverApp).get('/api/v1/driver/documents/driving_license/content');
    expect(res.status).toBe(200);
    expect(mockResolve).toHaveBeenCalledWith({
      driverId: DRIVER_ID,
      documentType: 'driving_license',
      token: undefined,
    });
  });

  it('allows admins to list a selected driver documents', async () => {
    testRole = 'admin';
    const res = await request(adminApp).get(`/api/v1/admin/fleet/drivers/${DRIVER_ID}/documents`);
    expect(res.status).toBe(200);
    expect(mockAdminList).toHaveBeenCalledWith(DRIVER_ID);
  });

  it('rejects drivers from admin document endpoints', async () => {
    testRole = 'driver';
    const res = await request(adminApp).get(`/api/v1/admin/fleet/drivers/${DRIVER_ID}/documents`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
    expect(mockAdminList).not.toHaveBeenCalled();
  });

  it('streams an admin signed document URL without a JWT', async () => {
    requireAuthEnabled = false;
    const res = await request(adminApp).get(
      `/api/v1/admin/fleet/drivers/${DRIVER_ID}/documents/insurance/content?token=signed-token`
    );
    expect(res.status).toBe(200);
    expect(mockResolve).toHaveBeenCalledWith({
      driverId: DRIVER_ID,
      documentType: 'insurance',
      token: 'signed-token',
    });
  });

  it('rejects admin document content with no JWT and no signed token', async () => {
    requireAuthEnabled = false;
    const res = await request(adminApp).get(
      `/api/v1/admin/fleet/drivers/${DRIVER_ID}/documents/insurance/content`
    );
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_FAILED');
  });

  it('streams admin document content with a signed token without trusting a spoofed driverId', async () => {
    testRole = 'admin';
    const res = await request(adminApp).get(
      `/api/v1/admin/fleet/drivers/${DRIVER_ID}/documents/insurance/content?token=signed-token`
    );
    expect(res.status).toBe(200);
    expect(mockResolve).toHaveBeenCalledWith({
      driverId: DRIVER_ID,
      documentType: 'insurance',
      token: 'signed-token',
    });
  });
});
