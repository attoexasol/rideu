"use strict";
/**
 * Request Validation Schemas using Zod
 *
 * All API request validation schemas
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.passengerRegisterSchema = exports.updateAdminUserSchema = exports.createAdminUserSchema = exports.getReportQuerySchema = exports.exportReportQuerySchema = exports.videoIdParamSchema = exports.videoUploadBodySchema = exports.scanPassengerSchema = exports.tripQrImageQuerySchema = exports.tripIdParamSchema = exports.getTripsQuerySchema = exports.updateTripSchema = exports.createTripSchema = exports.getLocationsQuerySchema = exports.submitLocationSchema = exports.cancelExchangeSchema = exports.confirmExchangeSchema = exports.initiateExchangeSchema = exports.exchangeIdParamSchema = exports.forceEndDutySchema = exports.assignDriverFleetSchema = exports.vehicleQrTokenIdParamSchema = exports.patchAdminFleetVehicleSchema = exports.listAdminFleetVehiclesQuerySchema = exports.fleetIdParamSchema = exports.dutyEndSchema = exports.dutyStartSchema = exports.dutyLocationSchema = exports.driverIdPathSchema = exports.checkOutSchema = exports.checkInSchema = exports.scanVehicleSchema = exports.createVehicleSchema = exports.companyCheckInQrQuerySchema = exports.vehicleScanSchema = exports.vehicleQrImageQuerySchema = exports.vehicleQrCodeParamSchema = exports.vehicleIdParamSchema = exports.driverIdParamSchema = exports.driverQrImageQuerySchema = exports.driverQrCodeParamSchema = exports.getDriversQuerySchema = exports.updateDriverStatusSchema = exports.updateDriverSchema = exports.createDriverSchema = exports.registerPassengerPushTokenSchema = exports.registerDriverPushTokenSchema = exports.refreshTokenSchema = exports.loginSchema = exports.updateCabIdentifierSchema = void 0;
exports.validate = exports.adminRideVideoPlaybackManifestSchema = exports.adminRideVideoAuditQuerySchema = exports.adminRideVideoSegmentsQuerySchema = exports.adminRideVideoSummaryQuerySchema = exports.adminRideVideoListQuerySchema = exports.videoSegmentListQuerySchema = exports.failVideoSegmentSchema = exports.completeVideoSegmentSchema = exports.registerVideoSegmentSchema = exports.videoSegmentIdParamSchema = exports.videoSegmentParamSchema = exports.videoSessionParamSchema = exports.recordingConsentSchema = exports.liveVideoChunkSchema = exports.placeSuggestionsQuerySchema = exports.nearbyDriversQuerySchema = exports.placeIdParamSchema = exports.updatePlaceSchema = exports.savePlaceSchema = exports.routePreviewSchema = exports.pickupSpotsQuerySchema = exports.reverseGeocodeQuerySchema = exports.placeDetailsQuerySchema = exports.placesAutocompleteQuerySchema = exports.assignDriverCategorySchema = exports.driverBookingStatusSchema = exports.driverCancelBookingSchema = exports.declineOfferSchema = exports.offerIdParamSchema = exports.bookingHistoryQuerySchema = exports.bookingIdParamSchema = exports.cancelBookingSchema = exports.createBookingSchema = exports.bookingQuoteSchema = exports.longitudeQuerySchema = exports.latitudeQuerySchema = exports.longitudeSchema = exports.latitudeSchema = exports.passengerForgotPasswordSchema = exports.passengerLoginSchema = void 0;
const zod_1 = require("zod");
const cabIdentifier_1 = require("../utils/cabIdentifier");
Object.defineProperty(exports, "updateCabIdentifierSchema", { enumerable: true, get: function () { return cabIdentifier_1.updateCabIdentifierSchema; } });
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
exports.registerDriverPushTokenSchema = zod_1.z.object({
    token: zod_1.z.string().min(8, 'FCM registration token is required').max(4096),
    deviceId: zod_1.z.string().min(1).max(255).optional(),
});
exports.registerPassengerPushTokenSchema = zod_1.z.object({
    token: zod_1.z.string().min(8, 'FCM registration token is required').max(4096),
    deviceId: zod_1.z.string().min(1).max(255).optional(),
});
// ============================================================================
// Driver Schemas
// ============================================================================
exports.createDriverSchema = zod_1.z
    .object({
    email: zod_1.z.string().email('Invalid email format'),
    password: zod_1.z.string().min(8, 'Password must be at least 8 characters'),
    name: zod_1.z.string().min(1, 'Name is required'),
    phone: zod_1.z.preprocess((val) => (val === '' ? undefined : val), zod_1.z.string().optional()),
    vehicleType: zod_1.z.preprocess((val) => (val === '' ? undefined : val), zod_1.z.enum(['sedan', 'suv', 'van', 'mini_bus', 'coach_bus']).optional()),
    vehicleId: zod_1.z.preprocess((val) => (val === '' ? undefined : val), zod_1.z.string().uuid('Invalid vehicle ID').optional()),
    cabName: zod_1.z.preprocess((val) => (val === '' ? undefined : val), zod_1.z.string().optional()),
    ...cabIdentifier_1.optionalCabIdentifierFields,
    cabNumber: zod_1.z.preprocess((val) => (val === '' ? undefined : val), zod_1.z.string().max(100, 'Cab number must be 100 characters or less').optional()),
    vehicleMake: zod_1.z.preprocess((val) => (val === '' ? undefined : val), zod_1.z.string().optional()),
    vehicleModel: zod_1.z.preprocess((val) => (val === '' ? undefined : val), zod_1.z.string().optional()),
    vehicleYear: zod_1.z.preprocess((val) => (val === '' ? undefined : val), zod_1.z
        .string()
        .regex(/^\d{4}$/, 'Year must be a 4-digit number')
        .optional()),
    vehicleColor: zod_1.z.preprocess((val) => (val === '' ? undefined : val), zod_1.z.string().optional()),
})
    .transform((data) => {
    const normalized = (0, cabIdentifier_1.normalizeCabIdentifierInput)(data);
    if (normalized.cabFieldType && normalized.cabValue) {
        return {
            ...data,
            cabFieldType: normalized.cabFieldType,
            cabValue: normalized.cabValue,
        };
    }
    return data;
})
    .superRefine(cabIdentifier_1.cabIdentifierPairRefinement);
exports.updateDriverSchema = zod_1.z
    .object({
    name: zod_1.z.string().min(1).optional(),
    phone: zod_1.z.preprocess((val) => (val === '' ? null : val), zod_1.z.string().optional().nullable()),
    vehicleType: zod_1.z.preprocess((val) => (val === '' ? null : val), zod_1.z.enum(['sedan', 'suv', 'van', 'mini_bus', 'coach_bus']).optional().nullable()),
    vehicleId: zod_1.z.preprocess((val) => (val === '' ? null : val), zod_1.z.string().uuid('Invalid vehicle ID').optional().nullable()),
    cabName: zod_1.z.preprocess((val) => (val === '' ? null : val), zod_1.z.string().optional().nullable()),
    ...cabIdentifier_1.optionalCabIdentifierFields,
    vehicleMake: zod_1.z.preprocess((val) => (val === '' ? null : val), zod_1.z.string().optional().nullable()),
    vehicleModel: zod_1.z.preprocess((val) => (val === '' ? null : val), zod_1.z.string().optional().nullable()),
    vehicleYear: zod_1.z.preprocess((val) => (val === '' ? null : val), zod_1.z
        .string()
        .regex(/^\d{4}$/, 'Year must be a 4-digit number')
        .optional()
        .nullable()),
    vehicleColor: zod_1.z.preprocess((val) => (val === '' ? null : val), zod_1.z.string().optional().nullable()),
    status: zod_1.z.enum(['online', 'offline']).optional(),
})
    .transform((data) => {
    const normalized = (0, cabIdentifier_1.normalizeCabIdentifierInput)(data);
    if (normalized.cabFieldType && normalized.cabValue) {
        return {
            ...data,
            cabFieldType: normalized.cabFieldType,
            cabValue: normalized.cabValue,
        };
    }
    return data;
})
    .superRefine(cabIdentifier_1.cabIdentifierPairRefinement);
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
exports.driverQrCodeParamSchema = zod_1.z.object({
    qrCode: zod_1.z.string().min(1, 'QR code is required').max(255),
});
exports.driverQrImageQuerySchema = zod_1.z.object({
    format: zod_1.z.enum(['png', 'base64']).optional().default('png'),
});
exports.driverIdParamSchema = zod_1.z.object({
    id: zod_1.z.string().uuid('Invalid driver ID'),
});
exports.vehicleIdParamSchema = zod_1.z.object({
    vehicleId: zod_1.z.string().uuid('Invalid vehicle ID'),
});
exports.vehicleQrCodeParamSchema = zod_1.z.object({
    qrCode: zod_1.z.string().min(1, 'QR code is required').max(255),
});
exports.vehicleQrImageQuerySchema = zod_1.z.object({
    format: zod_1.z.enum(['png', 'base64']).optional().default('png'),
});
exports.vehicleScanSchema = zod_1.z.object({
    qrCode: zod_1.z.string().min(1, 'QR code is required').max(255),
});
exports.companyCheckInQrQuerySchema = zod_1.z.object({
    format: zod_1.z.enum(['png', 'base64']).optional().default('png'),
});
exports.createVehicleSchema = zod_1.z.object({
    make: zod_1.z.preprocess((v) => (v === '' ? undefined : v), zod_1.z.string().optional()),
    model: zod_1.z.preprocess((v) => (v === '' ? undefined : v), zod_1.z.string().optional()),
    year: zod_1.z.preprocess((v) => (v === '' || v === null || v === undefined ? undefined : Number(v)), zod_1.z.number().int().min(1900).max(2100).optional()),
    plateNumber: zod_1.z.preprocess((v) => (v === '' ? undefined : v), zod_1.z.string().max(50).optional()),
    vin: zod_1.z.preprocess((v) => (v === '' ? undefined : v), zod_1.z.string().max(17).optional()),
    bodyNumber: zod_1.z.preprocess((v) => (v === '' ? undefined : v), zod_1.z.string().max(100).optional()),
    status: zod_1.z.enum(['active', 'inactive', 'maintenance']).optional().default('active'),
});
exports.scanVehicleSchema = zod_1.z.object({
    driverId: zod_1.z.string().uuid('Invalid driver ID'),
    vehicleQrCode: zod_1.z.string().min(1, 'Vehicle QR code is required').max(255),
});
exports.checkInSchema = zod_1.z.object({
    driverId: zod_1.z.string().uuid('Invalid driver ID'),
    qrCode: zod_1.z.literal('COMPANY_CHECKIN'),
    location: zod_1.z.preprocess((v) => (v === '' ? undefined : v), zod_1.z.string().max(255).optional()),
});
exports.checkOutSchema = zod_1.z.object({
    driverId: zod_1.z.string().uuid('Invalid driver ID'),
    qrCode: zod_1.z.literal('COMPANY_CHECKIN'),
});
exports.driverIdPathSchema = zod_1.z.object({
    driverId: zod_1.z.string().uuid('Invalid driver ID'),
});
// ============================================================================
// Duty & Fleet Schemas
// ============================================================================
exports.dutyLocationSchema = zod_1.z
    .object({
    latitude: zod_1.z.number().min(-90).max(90),
    longitude: zod_1.z.number().min(-180).max(180),
})
    .optional();
exports.dutyStartSchema = zod_1.z.object({
    vehicleQrToken: zod_1.z.string().min(8, 'Vehicle QR token is required'),
    location: exports.dutyLocationSchema,
    deviceId: zod_1.z.string().optional(),
});
exports.dutyEndSchema = zod_1.z.object({
    reason: zod_1.z.string().max(100).optional(),
    location: exports.dutyLocationSchema,
});
exports.fleetIdParamSchema = zod_1.z.object({
    fleetId: zod_1.z.string().uuid('Invalid fleet ID'),
});
exports.listAdminFleetVehiclesQuerySchema = zod_1.z.object({
    page: zod_1.z.coerce.number().int().min(1).optional(),
    limit: zod_1.z.coerce.number().int().min(1).max(1000).optional(),
    search: zod_1.z.string().max(200).optional(),
    fleetId: zod_1.z.string().uuid('Invalid fleet ID').optional(),
    organizationId: zod_1.z.string().uuid('Invalid organization ID').optional(),
    status: zod_1.z.string().max(50).optional(),
    serviceCategoryId: zod_1.z.string().uuid('Invalid service category ID').optional(),
    qrStatus: zod_1.z.enum(['active', 'none', 'revoked']).optional(),
    dutyStatus: zod_1.z.enum(['on_duty', 'off_duty']).optional(),
});
const optionalTrimmedString = zod_1.z.preprocess((v) => (v === '' || v === null || v === undefined ? undefined : v), zod_1.z.string().max(100).optional());
exports.patchAdminFleetVehicleSchema = zod_1.z
    .object({
    make: optionalTrimmedString,
    model: optionalTrimmedString,
    year: zod_1.z.preprocess((v) => (v === '' || v === null || v === undefined ? undefined : Number(v)), zod_1.z.number().int().min(1900).max(2100).optional()),
    color: zod_1.z.preprocess((v) => (v === '' || v === null || v === undefined ? undefined : v), zod_1.z.string().max(50).optional()),
    plateNumber: zod_1.z.preprocess((v) => (v === '' || v === null || v === undefined ? undefined : v), zod_1.z.string().max(50).optional()),
    capacity: zod_1.z.preprocess((v) => (v === '' || v === null || v === undefined ? undefined : Number(v)), zod_1.z.number().int().positive().optional()),
    fleetId: zod_1.z.string().uuid('Invalid fleet ID').optional(),
    status: zod_1.z
        .enum(['active', 'inactive', 'maintenance', 'approved', 'pending', 'rejected'])
        .optional(),
    approvalStatus: zod_1.z.enum(['approved', 'pending', 'rejected']).optional(),
    serviceCategoryIds: zod_1.z.array(zod_1.z.string().uuid('Invalid service category ID')).optional(),
})
    .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field is required',
});
exports.vehicleQrTokenIdParamSchema = zod_1.z.object({
    tokenId: zod_1.z.string().uuid('Invalid token ID'),
});
exports.assignDriverFleetSchema = zod_1.z.object({
    fleetId: zod_1.z.string().uuid('Invalid fleet ID'),
});
exports.forceEndDutySchema = zod_1.z.object({
    reason: zod_1.z.string().max(100).optional(),
    location: exports.dutyLocationSchema,
    emergency: zod_1.z.boolean().optional(),
});
exports.exchangeIdParamSchema = zod_1.z.object({
    exchangeId: zod_1.z.string().uuid('Invalid exchange ID'),
});
exports.initiateExchangeSchema = zod_1.z.object({
    scannedVehicleQrToken: zod_1.z.string().min(8, 'Vehicle QR token is required'),
    location: exports.dutyLocationSchema,
});
exports.confirmExchangeSchema = zod_1.z.object({
    scannedVehicleQrToken: zod_1.z.string().min(8, 'Vehicle QR token is required'),
    location: exports.dutyLocationSchema,
});
exports.cancelExchangeSchema = zod_1.z.object({
    reason: zod_1.z.string().max(255).optional(),
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
    bookingId: zod_1.z.string().uuid().optional().nullable(),
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
exports.tripIdParamSchema = zod_1.z.object({
    tripId: zod_1.z.string().uuid('Invalid trip ID'),
});
exports.tripQrImageQuerySchema = zod_1.z.object({
    format: zod_1.z.enum(['png', 'base64']).optional().default('png'),
});
exports.scanPassengerSchema = zod_1.z.object({
    driverId: zod_1.z.string().uuid('Invalid driver ID'),
    qrCode: zod_1.z.string().min(1, 'QR code is required').max(255),
});
// ============================================================================
// Trip Video Schemas
// ============================================================================
exports.videoUploadBodySchema = zod_1.z.object({
    tripId: zod_1.z.string().uuid('Invalid trip ID'),
    startTime: zod_1.z.string().datetime('Invalid startTime ISO timestamp'),
    endTime: zod_1.z.string().datetime('Invalid endTime ISO timestamp'),
    duration: zod_1.z.preprocess((v) => (v === '' || v === null || v === undefined ? undefined : Number(v)), zod_1.z.number().min(0, 'duration must be non-negative')),
});
exports.videoIdParamSchema = zod_1.z.object({
    videoId: zod_1.z.string().uuid('Invalid video ID'),
});
// ============================================================================
// Report Schemas
// ============================================================================
exports.exportReportQuerySchema = zod_1.z.object({
    type: zod_1.z.enum(['csv', 'pdf'], { required_error: 'Export type is required' }),
    reportType: zod_1.z.enum(['drivers', 'trips', 'locations'], {
        required_error: 'Report type is required',
    }),
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
// ============================================================================
// Passenger / Customer Schemas
// ============================================================================
exports.passengerRegisterSchema = zod_1.z.object({
    email: zod_1.z
        .string()
        .email('Valid email is required')
        .transform((value) => value.trim().toLowerCase()),
    password: zod_1.z.string().min(8, 'Password must be at least 8 characters'),
    name: zod_1.z.string().min(1, 'Name is required'),
});
exports.passengerLoginSchema = zod_1.z.object({
    auth0Token: zod_1.z.string().min(1, 'Auth0 token is required'),
    deviceId: zod_1.z.string().optional(),
    deviceInfo: zod_1.z.string().optional(),
});
exports.passengerForgotPasswordSchema = zod_1.z.object({
    email: zod_1.z
        .string()
        .email('Valid email is required')
        .transform((value) => value.trim().toLowerCase()),
});
exports.latitudeSchema = zod_1.z
    .number()
    .min(-90, 'Latitude must be between -90 and 90')
    .max(90, 'Latitude must be between -90 and 90');
exports.longitudeSchema = zod_1.z
    .number()
    .min(-180, 'Longitude must be between -180 and 180')
    .max(180, 'Longitude must be between -180 and 180');
exports.latitudeQuerySchema = zod_1.z.coerce
    .number()
    .min(-90, 'Latitude must be between -90 and 90')
    .max(90, 'Latitude must be between -90 and 90');
exports.longitudeQuerySchema = zod_1.z.coerce
    .number()
    .min(-180, 'Longitude must be between -180 and 180')
    .max(180, 'Longitude must be between -180 and 180');
const coordinatePointSchema = zod_1.z.object({
    latitude: exports.latitudeSchema,
    longitude: exports.longitudeSchema,
});
/** Flutter/Dart often sends explicit null for omitted optional strings. */
const nullishOptionalString = zod_1.z.preprocess((val) => (val === null || val === '' ? undefined : val), zod_1.z.string().optional());
exports.bookingQuoteSchema = zod_1.z.object({
    serviceCategoryId: zod_1.z.string().uuid().optional(),
    pickup: coordinatePointSchema.extend({
        address: zod_1.z.string().optional(),
        spotLabel: nullishOptionalString,
    }),
    dropoff: coordinatePointSchema.extend({
        address: zod_1.z.string().optional(),
        placeId: nullishOptionalString,
    }),
    stops: zod_1.z
        .array(coordinatePointSchema.extend({
        address: zod_1.z.string(),
        placeId: nullishOptionalString,
    }))
        .max(3)
        .optional()
        .default([]),
});
exports.createBookingSchema = zod_1.z
    .object({
    serviceCategoryId: zod_1.z.string().uuid(),
    pickup: coordinatePointSchema.extend({
        address: zod_1.z.string().min(1),
        spotLabel: nullishOptionalString,
    }),
    dropoff: coordinatePointSchema.extend({
        address: zod_1.z.string().min(1),
        placeId: nullishOptionalString,
    }),
    stops: zod_1.z
        .array(coordinatePointSchema.extend({
        address: zod_1.z.string(),
        placeId: nullishOptionalString,
    }))
        .max(3)
        .optional()
        .default([]),
    paymentMethodCode: zod_1.z.preprocess((val) => (val === null || val === undefined || val === '' ? 'cash' : val), zod_1.z.string().default('cash')),
    schedulingType: zod_1.z.enum(['instant', 'scheduled']).optional().default('instant'),
    scheduledPickupAt: zod_1.z.string().datetime().optional(),
})
    .superRefine((data, ctx) => {
    if (data.schedulingType === 'scheduled') {
        if (!data.scheduledPickupAt) {
            ctx.addIssue({
                code: zod_1.z.ZodIssueCode.custom,
                message: 'scheduledPickupAt is required for scheduled bookings',
                path: ['scheduledPickupAt'],
            });
            return;
        }
        const scheduledAt = new Date(data.scheduledPickupAt);
        if (Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now()) {
            ctx.addIssue({
                code: zod_1.z.ZodIssueCode.custom,
                message: 'scheduledPickupAt must be a future date and time',
                path: ['scheduledPickupAt'],
            });
        }
    }
});
exports.cancelBookingSchema = zod_1.z.object({
    reasonCode: zod_1.z.string().max(100).optional(),
    reason: zod_1.z.string().max(500).optional(),
});
exports.bookingIdParamSchema = zod_1.z.object({
    bookingId: zod_1.z.string().uuid(),
});
exports.bookingHistoryQuerySchema = zod_1.z.object({
    page: zod_1.z.coerce.number().int().min(1).optional().default(1),
    limit: zod_1.z.coerce.number().int().min(1).max(50).optional().default(20),
    filter: zod_1.z.enum(['all', 'completed', 'cancelled']).optional().default('all'),
});
exports.offerIdParamSchema = zod_1.z.object({
    offerId: zod_1.z.string().uuid(),
});
exports.declineOfferSchema = zod_1.z.object({
    offerId: zod_1.z.string().uuid().optional(),
    reason: zod_1.z.string().max(500).optional(),
});
exports.driverCancelBookingSchema = zod_1.z.object({
    reason: zod_1.z.string().max(500).optional(),
});
exports.driverBookingStatusSchema = zod_1.z.object({
    status: zod_1.z.enum(['driver_en_route', 'arrived', 'in_progress', 'completed']),
});
exports.assignDriverCategorySchema = zod_1.z.object({
    driverId: zod_1.z.string().uuid(),
    serviceCategoryId: zod_1.z.string().uuid(),
    isPrimary: zod_1.z.boolean().optional(),
});
exports.placesAutocompleteQuerySchema = zod_1.z.object({
    input: zod_1.z
        .string()
        .trim()
        .min(2, 'Search input must be at least 2 characters')
        .max(200, 'Search input is too long'),
    lat: exports.latitudeQuerySchema.optional(),
    lng: exports.longitudeQuerySchema.optional(),
    city: zod_1.z.string().trim().max(100).optional(),
    country: zod_1.z.string().trim().length(2).optional(),
    sessionToken: zod_1.z.string().trim().max(256).optional(),
});
exports.placeDetailsQuerySchema = zod_1.z.object({
    placeId: zod_1.z.string().trim().min(1, 'placeId is required').max(512),
    sessionToken: zod_1.z.string().trim().max(256).optional(),
});
exports.reverseGeocodeQuerySchema = zod_1.z.object({
    lat: exports.latitudeQuerySchema,
    lng: exports.longitudeQuerySchema,
});
exports.pickupSpotsQuerySchema = zod_1.z.object({
    lat: exports.latitudeQuerySchema,
    lng: exports.longitudeQuerySchema,
    address: zod_1.z.string().trim().max(500).optional(),
});
exports.routePreviewSchema = zod_1.z.object({
    pickup: coordinatePointSchema.extend({
        address: zod_1.z.string().optional(),
        placeId: zod_1.z.string().optional(),
    }),
    dropoff: coordinatePointSchema.extend({
        address: zod_1.z.string().optional(),
        placeId: zod_1.z.string().optional(),
    }),
    stops: zod_1.z
        .array(coordinatePointSchema.extend({
        address: zod_1.z.string().optional(),
        placeId: zod_1.z.string().optional(),
    }))
        .max(3)
        .optional(),
    travelMode: zod_1.z.enum(['DRIVE', 'TWO_WHEELER']).optional(),
    routePreference: zod_1.z.enum(['TRAFFIC_AWARE', 'TRAFFIC_UNAWARE']).optional(),
});
exports.savePlaceSchema = zod_1.z.object({
    label: zod_1.z.string().trim().min(1).max(255),
    address: zod_1.z.string().trim().min(1).max(500),
    latitude: exports.latitudeSchema,
    longitude: exports.longitudeSchema,
    placeId: zod_1.z.string().trim().max(255).optional(),
    city: zod_1.z.string().trim().max(255).optional(),
    countryCode: zod_1.z.string().trim().length(2).optional(),
    placeType: zod_1.z.enum(['home', 'work', 'favorite', 'recent']).default('recent'),
});
exports.updatePlaceSchema = exports.savePlaceSchema
    .partial()
    .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field is required to update',
});
exports.placeIdParamSchema = zod_1.z.object({
    placeId: zod_1.z.string().uuid('Invalid place ID'),
});
exports.nearbyDriversQuerySchema = zod_1.z.object({
    lat: exports.latitudeQuerySchema,
    lng: exports.longitudeQuerySchema,
    serviceCategoryId: zod_1.z.string().uuid(),
    radiusKm: zod_1.z.coerce.number().min(0.5).max(30).optional(),
});
exports.placeSuggestionsQuerySchema = zod_1.z.object({
    lat: exports.latitudeQuerySchema.optional(),
    lng: exports.longitudeQuerySchema.optional(),
    limit: zod_1.z.coerce.number().int().min(1).max(30).optional(),
});
exports.liveVideoChunkSchema = zod_1.z.object({
    sessionId: zod_1.z.string().uuid(),
    segmentIndex: zod_1.z.coerce.number().int().min(0),
    durationSeconds: zod_1.z.coerce.number().optional(),
});
exports.recordingConsentSchema = zod_1.z.object({
    consent: zod_1.z.boolean(),
    consentVersion: zod_1.z.string().trim().min(1).max(50).optional(),
});
exports.videoSessionParamSchema = zod_1.z.object({
    sessionId: zod_1.z.string().uuid('Invalid video session ID'),
});
exports.videoSegmentParamSchema = zod_1.z.object({
    sessionId: zod_1.z.string().uuid('Invalid video session ID'),
    segmentId: zod_1.z.string().uuid('Invalid video segment ID'),
});
exports.videoSegmentIdParamSchema = zod_1.z.object({
    segmentId: zod_1.z.string().uuid('Invalid video segment ID'),
});
exports.registerVideoSegmentSchema = zod_1.z.object({
    clientSegmentId: zod_1.z.string().uuid('clientSegmentId must be a UUID'),
    sequenceNumber: zod_1.z.number().int().min(0),
    durationMs: zod_1.z.number().int().min(0).optional(),
    fileSizeBytes: zod_1.z.number().int().min(0).optional(),
    mimeType: zod_1.z.enum(['video/mp4', 'video/quicktime']),
    recordedAt: zod_1.z.string().datetime({ offset: true }).optional(),
    checksum: zod_1.z
        .string()
        .regex(/^[a-fA-F0-9]{64}$/, 'checksum must be SHA-256 hex')
        .optional(),
});
exports.completeVideoSegmentSchema = zod_1.z.object({
    checksum: zod_1.z
        .string()
        .regex(/^[a-fA-F0-9]{64}$/, 'checksum must be SHA-256 hex')
        .optional(),
    fileSizeBytes: zod_1.z.number().int().min(0).optional(),
});
exports.failVideoSegmentSchema = zod_1.z.object({
    reason: zod_1.z.string().trim().max(1000).optional(),
});
exports.videoSegmentListQuerySchema = zod_1.z.object({
    status: zod_1.z.enum(['pending', 'uploading', 'uploaded', 'verified', 'failed']).optional(),
});
exports.adminRideVideoListQuerySchema = zod_1.z.object({
    page: zod_1.z.coerce.number().int().min(1).optional(),
    limit: zod_1.z.coerce.number().int().min(1).max(100).optional(),
    search: zod_1.z.string().trim().max(200).optional(),
    bookingId: zod_1.z.string().uuid().optional(),
    sessionId: zod_1.z.string().uuid().optional(),
    driverId: zod_1.z.string().uuid().optional(),
    passengerId: zod_1.z.string().uuid().optional(),
    driverPhone: zod_1.z.string().trim().max(50).optional(),
    passengerPhone: zod_1.z.string().trim().max(50).optional(),
    vehicleRegistration: zod_1.z.string().trim().max(50).optional(),
    bookingStatus: zod_1.z.string().trim().max(50).optional(),
    recordingStatus: zod_1.z.string().trim().max(50).optional(),
    consentStatus: zod_1.z
        .enum(['not_required', 'pending', 'granted', 'denied', 'revoked', 'required'])
        .optional(),
    uploadHealth: zod_1.z
        .enum([
        'healthy',
        'delayed',
        'missing_segments',
        'failed_segments',
        'duplicate_segments',
        'incomplete',
        'unknown',
    ])
        .optional(),
    processingStatus: zod_1.z.string().trim().max(50).optional(),
    retentionStatus: zod_1.z.enum(['active', 'expiring_soon', 'expired', 'deleted']).optional(),
    serviceType: zod_1.z.string().trim().max(100).optional(),
    dateFrom: zod_1.z.string().datetime({ offset: true }).optional(),
    dateTo: zod_1.z.string().datetime({ offset: true }).optional(),
    sortBy: zod_1.z.enum(['createdAt', 'finalizedAt', 'startedAt', 'rideDate']).optional(),
    sortOrder: zod_1.z.enum(['asc', 'desc']).optional(),
});
exports.adminRideVideoSummaryQuerySchema = zod_1.z.object({
    dateFrom: zod_1.z.string().datetime({ offset: true }).optional(),
    dateTo: zod_1.z.string().datetime({ offset: true }).optional(),
    driverId: zod_1.z.string().uuid().optional(),
    passengerId: zod_1.z.string().uuid().optional(),
});
exports.adminRideVideoSegmentsQuerySchema = zod_1.z.object({
    page: zod_1.z.coerce.number().int().min(1).optional(),
    limit: zod_1.z.coerce.number().int().min(1).max(200).optional(),
    sortOrder: zod_1.z.enum(['asc', 'desc']).optional(),
});
exports.adminRideVideoAuditQuerySchema = zod_1.z.object({
    page: zod_1.z.coerce.number().int().min(1).optional(),
    limit: zod_1.z.coerce.number().int().min(1).max(100).optional(),
});
exports.adminRideVideoPlaybackManifestSchema = zod_1.z
    .object({
    fromIndex: zod_1.z.coerce.number().int().min(0).optional(),
    fromSegmentIndex: zod_1.z.coerce.number().int().min(0).optional(),
    fromOffsetSeconds: zod_1.z.coerce.number().int().min(0).optional(),
    sinceManifestVersion: zod_1.z.coerce.number().int().min(0).optional(),
    limit: zod_1.z.coerce.number().int().min(1).max(30).optional(),
})
    .optional()
    .default({});
const response_1 = require("../utils/response");
const validate = (schema, source = 'body') => {
    return (req, res, next) => {
        try {
            const data = req[source];
            const result = schema.safeParse(data);
            if (!result.success) {
                const fields = result.error.errors.map((e) => e.path.join('.'));
                console.warn('[Validation] request failed', {
                    method: req.method,
                    path: req.path,
                    fields,
                });
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