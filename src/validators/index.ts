/**
 * Request Validation Schemas using Zod
 *
 * All API request validation schemas
 */

import { z } from 'zod';

// ============================================================================
// Authentication Schemas
// ============================================================================

export const loginSchema = z.object({
  auth0Token: z.string().min(1, 'Auth0 token is required'),
  deviceId: z.string().optional(),
  deviceInfo: z.string().optional(),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

// ============================================================================
// Driver Schemas
// ============================================================================

export const createDriverSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(1, 'Name is required'),
  phone: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().optional()
  ),
  vehicleType: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.enum(['sedan', 'suv', 'van', 'mini_bus', 'coach_bus']).optional()
  ),
  vehicleId: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().uuid('Invalid vehicle ID').optional()
  ),
  cabName: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().optional()
  ),
  cabNumber: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().optional()
  ),
  vehicleMake: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().optional()
  ),
  vehicleModel: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().optional()
  ),
  vehicleYear: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().regex(/^\d{4}$/, 'Year must be a 4-digit number').optional()
  ),
  vehicleColor: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().optional()
  ),
});

export const updateDriverSchema = z.object({
  name: z.string().min(1).optional(),
  phone: z.preprocess(
    (val) => (val === '' ? null : val),
    z.string().optional().nullable()
  ),
  vehicleType: z.preprocess(
    (val) => (val === '' ? null : val),
    z.enum(['sedan', 'suv', 'van', 'mini_bus', 'coach_bus']).optional().nullable()
  ),
  vehicleId: z.preprocess(
    (val) => (val === '' ? null : val),
    z.string().uuid('Invalid vehicle ID').optional().nullable()
  ),
  cabName: z.preprocess(
    (val) => (val === '' ? null : val),
    z.string().optional().nullable()
  ),
  cabNumber: z.preprocess(
    (val) => (val === '' ? null : val),
    z.string().optional().nullable()
  ),
  vehicleMake: z.preprocess(
    (val) => (val === '' ? null : val),
    z.string().optional().nullable()
  ),
  vehicleModel: z.preprocess(
    (val) => (val === '' ? null : val),
    z.string().optional().nullable()
  ),
  vehicleYear: z.preprocess(
    (val) => (val === '' ? null : val),
    z.string().regex(/^\d{4}$/, 'Year must be a 4-digit number').optional().nullable()
  ),
  vehicleColor: z.preprocess(
    (val) => (val === '' ? null : val),
    z.string().optional().nullable()
  ),
  status: z.enum(['online', 'offline']).optional(),
});

export const updateDriverStatusSchema = z.object({
  status: z.enum(['online', 'offline']),
});

export const getDriversQuerySchema = z.object({
  status: z.enum(['online', 'offline']).optional(),
  vehicleType: z.enum(['sedan', 'suv', 'van', 'mini_bus', 'coach_bus']).optional(),
  search: z.string().optional(),
  page: z.string().regex(/^\d+$/).transform(Number).optional().default('1'),
  limit: z.string().regex(/^\d+$/).transform(Number).optional().default('20'),
});

// ============================================================================
// Location Schemas
// ============================================================================

export const submitLocationSchema = z.object({
  latitude: z.number().min(-90).max(90, 'Latitude must be between -90 and 90'),
  longitude: z.number().min(-180).max(180, 'Longitude must be between -180 and 180'),
  accuracy: z.number().min(0).optional(),
  speed: z.number().min(-1).optional(), // -1 indicates unavailable on iOS
  heading: z.number().min(-1).max(360).optional(), // -1 indicates unavailable on iOS
  timestamp: z.string().datetime('Invalid ISO timestamp'),
});

export const getLocationsQuerySchema = z.object({
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  limit: z.string().regex(/^\d+$/).transform(Number).optional().default('100'),
});

// ============================================================================
// Trip Schemas
// ============================================================================

export const createTripSchema = z.object({
  startTime: z.string().datetime('Invalid ISO timestamp'),
  startLocationId: z.string().uuid().optional(),
});

export const updateTripSchema = z.object({
  endTime: z.string().datetime('Invalid ISO timestamp').optional(),
  endLocationId: z.string().uuid().optional(),
  distance: z.number().min(0).optional(),
  status: z.enum(['in_progress', 'completed', 'cancelled']).optional(),
});

export const getTripsQuerySchema = z.object({
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  status: z.enum(['in_progress', 'completed', 'cancelled']).optional(),
  page: z.string().regex(/^\d+$/).transform(Number).optional().default('1'),
  limit: z.string().regex(/^\d+$/).transform(Number).optional().default('20'),
});

// ============================================================================
// Report Schemas
// ============================================================================

export const exportReportQuerySchema = z.object({
  type: z.enum(['csv', 'pdf'], { required_error: 'Export type is required' }),
  reportType: z.enum(['drivers', 'trips', 'locations'], { required_error: 'Report type is required' }),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  driverId: z.string().uuid().optional(),
});

export const getReportQuerySchema = z.object({
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

// ============================================================================
// Admin User Schemas
// ============================================================================

export const createAdminUserSchema = z.object({
  email: z.string().email('Invalid email format'),
  name: z.string().min(1, 'Name is required'),
  role: z.enum(['admin', 'super_admin'], { required_error: 'Role is required' }),
});

export const updateAdminUserSchema = z.object({
  name: z.string().min(1).optional(),
  role: z.enum(['admin', 'super_admin']).optional(),
});

// ============================================================================
// Validation Helper
// ============================================================================

/**
 * Middleware factory for validating request data
 *
 * @param schema - Zod schema to validate against
 * @param source - Where to find the data ('body', 'query', 'params')
 */
import { Request, Response, NextFunction } from 'express';
import { sendValidationError } from '../utils/response';

export const validate = (
  schema: z.ZodSchema,
  source: 'body' | 'query' | 'params' = 'body'
) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const data = req[source];
      const result = schema.safeParse(data);

      if (!result.success) {
        sendValidationError(res, result.error.errors);
        return;
      }

      // Replace request data with validated & transformed data
      req[source] = result.data;
      next();
    } catch (error) {
      sendValidationError(res, { message: 'Validation error', error });
    }
  };
};
