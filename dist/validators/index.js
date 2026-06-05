"use strict";
/**
 * Request Validation Schemas using Zod
 *
 * All API request validation schemas
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.validate = exports.updateAdminUserSchema = exports.createAdminUserSchema = exports.getReportQuerySchema = exports.exportReportQuerySchema = exports.getTripsQuerySchema = exports.updateTripSchema = exports.createTripSchema = exports.getLocationsQuerySchema = exports.submitLocationSchema = exports.getDriversQuerySchema = exports.updateDriverStatusSchema = exports.updateDriverSchema = exports.createDriverSchema = exports.refreshTokenSchema = exports.loginSchema = void 0;
const zod_1 = require("zod");
// ============================================================================
// Authentication Schemas
// ============================================================================
exports.loginSchema = zod_1.z.object({
    auth0Token: zod_1.z.string().min(1, 'Auth0 token is required'),
    deviceId: zod_1.z.string().optional(),
    deviceInfo: zod_1.z.string().optional(),
});
exports.refreshTokenSchema = zod_1.z.object({
    refreshToken: zod_1.z.string().min(1, 'Refresh token is required'),
});
// ============================================================================
// Driver Schemas
// ============================================================================
exports.createDriverSchema = zod_1.z.object({
    email: zod_1.z.string().email('Invalid email format'),
    password: zod_1.z.string().min(8, 'Password must be at least 8 characters'),
    name: zod_1.z.string().min(1, 'Name is required'),
    phone: zod_1.z.preprocess((val) => (val === '' ? undefined : val), zod_1.z.string().optional()),
    vehicleType: zod_1.z.preprocess((val) => (val === '' ? undefined : val), zod_1.z.enum(['sedan', 'suv', 'van', 'mini_bus', 'coach_bus']).optional()),
    vehicleId: zod_1.z.preprocess((val) => (val === '' ? undefined : val), zod_1.z.string().uuid('Invalid vehicle ID').optional()),
    cabName: zod_1.z.preprocess((val) => (val === '' ? undefined : val), zod_1.z.string().optional()),
    cabNumber: zod_1.z.preprocess((val) => (val === '' ? undefined : val), zod_1.z.string().optional()),
    vehicleMake: zod_1.z.preprocess((val) => (val === '' ? undefined : val), zod_1.z.string().optional()),
    vehicleModel: zod_1.z.preprocess((val) => (val === '' ? undefined : val), zod_1.z.string().optional()),
    vehicleYear: zod_1.z.preprocess((val) => (val === '' ? undefined : val), zod_1.z.string().regex(/^\d{4}$/, 'Year must be a 4-digit number').optional()),
    vehicleColor: zod_1.z.preprocess((val) => (val === '' ? undefined : val), zod_1.z.string().optional()),
});
exports.updateDriverSchema = zod_1.z.object({
    name: zod_1.z.string().min(1).optional(),
    phone: zod_1.z.preprocess((val) => (val === '' ? null : val), zod_1.z.string().optional().nullable()),
    vehicleType: zod_1.z.preprocess((val) => (val === '' ? null : val), zod_1.z.enum(['sedan', 'suv', 'van', 'mini_bus', 'coach_bus']).optional().nullable()),
    vehicleId: zod_1.z.preprocess((val) => (val === '' ? null : val), zod_1.z.string().uuid('Invalid vehicle ID').optional().nullable()),
    cabName: zod_1.z.preprocess((val) => (val === '' ? null : val), zod_1.z.string().optional().nullable()),
    cabNumber: zod_1.z.preprocess((val) => (val === '' ? null : val), zod_1.z.string().optional().nullable()),
    vehicleMake: zod_1.z.preprocess((val) => (val === '' ? null : val), zod_1.z.string().optional().nullable()),
    vehicleModel: zod_1.z.preprocess((val) => (val === '' ? null : val), zod_1.z.string().optional().nullable()),
    vehicleYear: zod_1.z.preprocess((val) => (val === '' ? null : val), zod_1.z.string().regex(/^\d{4}$/, 'Year must be a 4-digit number').optional().nullable()),
    vehicleColor: zod_1.z.preprocess((val) => (val === '' ? null : val), zod_1.z.string().optional().nullable()),
    status: zod_1.z.enum(['online', 'offline']).optional(),
});
exports.updateDriverStatusSchema = zod_1.z.object({
    status: zod_1.z.enum(['online', 'offline']),
});
exports.getDriversQuerySchema = zod_1.z.object({
    status: zod_1.z.enum(['online', 'offline']).optional(),
    vehicleType: zod_1.z.enum(['sedan', 'suv', 'van', 'mini_bus', 'coach_bus']).optional(),
    search: zod_1.z.string().optional(),
    page: zod_1.z.string().regex(/^\d+$/).transform(Number).optional().default('1'),
    limit: zod_1.z.string().regex(/^\d+$/).transform(Number).optional().default('20'),
});
// ============================================================================
// Location Schemas
// ============================================================================
exports.submitLocationSchema = zod_1.z.object({
    latitude: zod_1.z.number().min(-90).max(90, 'Latitude must be between -90 and 90'),
    longitude: zod_1.z.number().min(-180).max(180, 'Longitude must be between -180 and 180'),
    accuracy: zod_1.z.number().min(0).optional(),
    speed: zod_1.z.number().min(-1).optional(), // -1 indicates unavailable on iOS
    heading: zod_1.z.number().min(-1).max(360).optional(), // -1 indicates unavailable on iOS
    timestamp: zod_1.z.string().datetime('Invalid ISO timestamp'),
});
exports.getLocationsQuerySchema = zod_1.z.object({
    startDate: zod_1.z.string().datetime().optional(),
    endDate: zod_1.z.string().datetime().optional(),
    limit: zod_1.z.string().regex(/^\d+$/).transform(Number).optional().default('100'),
});
// ============================================================================
// Trip Schemas
// ============================================================================
exports.createTripSchema = zod_1.z.object({
    startTime: zod_1.z.string().datetime('Invalid ISO timestamp'),
    startLocationId: zod_1.z.string().uuid().optional(),
});
exports.updateTripSchema = zod_1.z.object({
    endTime: zod_1.z.string().datetime('Invalid ISO timestamp').optional(),
    endLocationId: zod_1.z.string().uuid().optional(),
    distance: zod_1.z.number().min(0).optional(),
    status: zod_1.z.enum(['in_progress', 'completed', 'cancelled']).optional(),
});
exports.getTripsQuerySchema = zod_1.z.object({
    startDate: zod_1.z.string().datetime().optional(),
    endDate: zod_1.z.string().datetime().optional(),
    status: zod_1.z.enum(['in_progress', 'completed', 'cancelled']).optional(),
    page: zod_1.z.string().regex(/^\d+$/).transform(Number).optional().default('1'),
    limit: zod_1.z.string().regex(/^\d+$/).transform(Number).optional().default('20'),
});
// ============================================================================
// Report Schemas
// ============================================================================
exports.exportReportQuerySchema = zod_1.z.object({
    type: zod_1.z.enum(['csv', 'pdf'], { required_error: 'Export type is required' }),
    reportType: zod_1.z.enum(['drivers', 'trips', 'locations'], { required_error: 'Report type is required' }),
    startDate: zod_1.z.string().datetime().optional(),
    endDate: zod_1.z.string().datetime().optional(),
    driverId: zod_1.z.string().uuid().optional(),
});
exports.getReportQuerySchema = zod_1.z.object({
    startDate: zod_1.z.string().datetime().optional(),
    endDate: zod_1.z.string().datetime().optional(),
});
// ============================================================================
// Admin User Schemas
// ============================================================================
exports.createAdminUserSchema = zod_1.z.object({
    email: zod_1.z.string().email('Invalid email format'),
    name: zod_1.z.string().min(1, 'Name is required'),
    role: zod_1.z.enum(['admin', 'super_admin'], { required_error: 'Role is required' }),
});
exports.updateAdminUserSchema = zod_1.z.object({
    name: zod_1.z.string().min(1).optional(),
    role: zod_1.z.enum(['admin', 'super_admin']).optional(),
});
const response_1 = require("../utils/response");
const validate = (schema, source = 'body') => {
    return (req, res, next) => {
        try {
            const data = req[source];
            const result = schema.safeParse(data);
            if (!result.success) {
                (0, response_1.sendValidationError)(res, result.error.errors);
                return;
            }
            // Replace request data with validated & transformed data
            req[source] = result.data;
            next();
        }
        catch (error) {
            (0, response_1.sendValidationError)(res, { message: 'Validation error', error });
        }
    };
};
exports.validate = validate;
//# sourceMappingURL=index.js.map