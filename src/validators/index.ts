/**
 * Request Validation Schemas using Zod
 *
 * All API request validation schemas
 */

import { z } from 'zod';
import {
  cabIdentifierPairRefinement,
  normalizeCabIdentifierInput,
  optionalCabIdentifierFields,
  updateCabIdentifierSchema,
} from '../utils/cabIdentifier';

export { updateCabIdentifierSchema };

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

export const registerDriverPushTokenSchema = z.object({
  token: z.string().min(8, 'FCM registration token is required').max(4096),
  deviceId: z.string().min(1).max(255).optional(),
});

export const registerPassengerPushTokenSchema = z.object({
  token: z.string().min(8, 'FCM registration token is required').max(4096),
  deviceId: z.string().min(1).max(255).optional(),
});

// ============================================================================
// Driver Schemas
// ============================================================================

export const createDriverSchema = z
  .object({
    email: z.string().email('Invalid email format'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    name: z.string().min(1, 'Name is required'),
    phone: z.preprocess((val) => (val === '' ? undefined : val), z.string().optional()),
    vehicleType: z.preprocess(
      (val) => (val === '' ? undefined : val),
      z.enum(['sedan', 'suv', 'van', 'mini_bus', 'coach_bus']).optional()
    ),
    vehicleId: z.preprocess(
      (val) => (val === '' ? undefined : val),
      z.string().uuid('Invalid vehicle ID').optional()
    ),
    cabName: z.preprocess((val) => (val === '' ? undefined : val), z.string().optional()),
    ...optionalCabIdentifierFields,
    cabNumber: z.preprocess(
      (val) => (val === '' ? undefined : val),
      z.string().max(100, 'Cab number must be 100 characters or less').optional()
    ),
    vehicleMake: z.preprocess((val) => (val === '' ? undefined : val), z.string().optional()),
    vehicleModel: z.preprocess((val) => (val === '' ? undefined : val), z.string().optional()),
    vehicleYear: z.preprocess(
      (val) => (val === '' ? undefined : val),
      z
        .string()
        .regex(/^\d{4}$/, 'Year must be a 4-digit number')
        .optional()
    ),
    vehicleColor: z.preprocess((val) => (val === '' ? undefined : val), z.string().optional()),
  })
  .transform((data) => {
    const normalized = normalizeCabIdentifierInput(data);
    if (normalized.cabFieldType && normalized.cabValue) {
      return {
        ...data,
        cabFieldType: normalized.cabFieldType,
        cabValue: normalized.cabValue,
      };
    }
    return data;
  })
  .superRefine(cabIdentifierPairRefinement);

export const updateDriverSchema = z
  .object({
    name: z.string().min(1).optional(),
    phone: z.preprocess((val) => (val === '' ? null : val), z.string().optional().nullable()),
    vehicleType: z.preprocess(
      (val) => (val === '' ? null : val),
      z.enum(['sedan', 'suv', 'van', 'mini_bus', 'coach_bus']).optional().nullable()
    ),
    vehicleId: z.preprocess(
      (val) => (val === '' ? null : val),
      z.string().uuid('Invalid vehicle ID').optional().nullable()
    ),
    cabName: z.preprocess((val) => (val === '' ? null : val), z.string().optional().nullable()),
    ...optionalCabIdentifierFields,
    vehicleMake: z.preprocess((val) => (val === '' ? null : val), z.string().optional().nullable()),
    vehicleModel: z.preprocess(
      (val) => (val === '' ? null : val),
      z.string().optional().nullable()
    ),
    vehicleYear: z.preprocess(
      (val) => (val === '' ? null : val),
      z
        .string()
        .regex(/^\d{4}$/, 'Year must be a 4-digit number')
        .optional()
        .nullable()
    ),
    vehicleColor: z.preprocess(
      (val) => (val === '' ? null : val),
      z.string().optional().nullable()
    ),
    status: z.enum(['online', 'offline']).optional(),
  })
  .transform((data) => {
    const normalized = normalizeCabIdentifierInput(data);
    if (normalized.cabFieldType && normalized.cabValue) {
      return {
        ...data,
        cabFieldType: normalized.cabFieldType,
        cabValue: normalized.cabValue,
      };
    }
    return data;
  })
  .superRefine(cabIdentifierPairRefinement);

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

export const driverQrCodeParamSchema = z.object({
  qrCode: z.string().min(1, 'QR code is required').max(255),
});

export const driverQrImageQuerySchema = z.object({
  format: z.enum(['png', 'base64']).optional().default('png'),
});

export const driverIdParamSchema = z.object({
  id: z.string().uuid('Invalid driver ID'),
});

export const vehicleIdParamSchema = z.object({
  vehicleId: z.string().uuid('Invalid vehicle ID'),
});

export const vehicleQrCodeParamSchema = z.object({
  qrCode: z.string().min(1, 'QR code is required').max(255),
});

export const vehicleQrImageQuerySchema = z.object({
  format: z.enum(['png', 'base64']).optional().default('png'),
});

export const vehicleScanSchema = z.object({
  qrCode: z.string().min(1, 'QR code is required').max(255),
});

export const companyCheckInQrQuerySchema = z.object({
  format: z.enum(['png', 'base64']).optional().default('png'),
});

export const createVehicleSchema = z.object({
  make: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  model: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  year: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : Number(v)),
    z.number().int().min(1900).max(2100).optional()
  ),
  plateNumber: z.preprocess((v) => (v === '' ? undefined : v), z.string().max(50).optional()),
  vin: z.preprocess((v) => (v === '' ? undefined : v), z.string().max(17).optional()),
  bodyNumber: z.preprocess((v) => (v === '' ? undefined : v), z.string().max(100).optional()),
  status: z.enum(['active', 'inactive', 'maintenance']).optional().default('active'),
});

export const scanVehicleSchema = z.object({
  driverId: z.string().uuid('Invalid driver ID'),
  vehicleQrCode: z.string().min(1, 'Vehicle QR code is required').max(255),
});

export const checkInSchema = z.object({
  driverId: z.string().uuid('Invalid driver ID'),
  qrCode: z.literal('COMPANY_CHECKIN'),
  location: z.preprocess((v) => (v === '' ? undefined : v), z.string().max(255).optional()),
});

export const checkOutSchema = z.object({
  driverId: z.string().uuid('Invalid driver ID'),
  qrCode: z.literal('COMPANY_CHECKIN'),
});

export const driverIdPathSchema = z.object({
  driverId: z.string().uuid('Invalid driver ID'),
});

// ============================================================================
// Duty & Fleet Schemas
// ============================================================================

export const dutyLocationSchema = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  })
  .optional();

export const dutyStartSchema = z.object({
  vehicleQrToken: z.string().min(8, 'Vehicle QR token is required'),
  location: dutyLocationSchema,
  deviceId: z.string().optional(),
});

export const dutyEndSchema = z.object({
  reason: z.string().max(100).optional(),
  location: dutyLocationSchema,
});

export const fleetIdParamSchema = z.object({
  fleetId: z.string().uuid('Invalid fleet ID'),
});

export const listAdminFleetVehiclesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  search: z.string().max(200).optional(),
  fleetId: z.string().uuid('Invalid fleet ID').optional(),
  organizationId: z.string().uuid('Invalid organization ID').optional(),
  status: z.string().max(50).optional(),
  serviceCategoryId: z.string().uuid('Invalid service category ID').optional(),
  qrStatus: z.enum(['active', 'none', 'revoked']).optional(),
  dutyStatus: z.enum(['on_duty', 'off_duty']).optional(),
});

const optionalTrimmedString = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? undefined : v),
  z.string().max(100).optional()
);

export const patchAdminFleetVehicleSchema = z
  .object({
    make: optionalTrimmedString,
    model: optionalTrimmedString,
    year: z.preprocess(
      (v) => (v === '' || v === null || v === undefined ? undefined : Number(v)),
      z.number().int().min(1900).max(2100).optional()
    ),
    color: z.preprocess(
      (v) => (v === '' || v === null || v === undefined ? undefined : v),
      z.string().max(50).optional()
    ),
    plateNumber: z.preprocess(
      (v) => (v === '' || v === null || v === undefined ? undefined : v),
      z.string().max(50).optional()
    ),
    capacity: z.preprocess(
      (v) => (v === '' || v === null || v === undefined ? undefined : Number(v)),
      z.number().int().positive().optional()
    ),
    fleetId: z.string().uuid('Invalid fleet ID').optional(),
    status: z
      .enum(['active', 'inactive', 'maintenance', 'approved', 'pending', 'rejected'])
      .optional(),
    approvalStatus: z.enum(['approved', 'pending', 'rejected']).optional(),
    serviceCategoryIds: z.array(z.string().uuid('Invalid service category ID')).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field is required',
  });

export const vehicleQrTokenIdParamSchema = z.object({
  tokenId: z.string().uuid('Invalid token ID'),
});

export const assignDriverFleetSchema = z.object({
  fleetId: z.string().uuid('Invalid fleet ID'),
});

export const forceEndDutySchema = z.object({
  reason: z.string().max(100).optional(),
  location: dutyLocationSchema,
  emergency: z.boolean().optional(),
});

export const exchangeIdParamSchema = z.object({
  exchangeId: z.string().uuid('Invalid exchange ID'),
});

export const initiateExchangeSchema = z.object({
  scannedVehicleQrToken: z.string().min(8, 'Vehicle QR token is required'),
  location: dutyLocationSchema,
});

export const confirmExchangeSchema = z.object({
  scannedVehicleQrToken: z.string().min(8, 'Vehicle QR token is required'),
  location: dutyLocationSchema,
});

export const cancelExchangeSchema = z.object({
  reason: z.string().max(255).optional(),
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
  bookingId: z.string().uuid().optional().nullable(),
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

export const tripIdParamSchema = z.object({
  tripId: z.string().uuid('Invalid trip ID'),
});

export const tripQrImageQuerySchema = z.object({
  format: z.enum(['png', 'base64']).optional().default('png'),
});

export const scanPassengerSchema = z.object({
  driverId: z.string().uuid('Invalid driver ID'),
  qrCode: z.string().min(1, 'QR code is required').max(255),
});

// ============================================================================
// Trip Video Schemas
// ============================================================================

export const videoUploadBodySchema = z.object({
  tripId: z.string().uuid('Invalid trip ID'),
  startTime: z.string().datetime('Invalid startTime ISO timestamp'),
  endTime: z.string().datetime('Invalid endTime ISO timestamp'),
  duration: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : Number(v)),
    z.number().min(0, 'duration must be non-negative')
  ),
});

export const videoIdParamSchema = z.object({
  videoId: z.string().uuid('Invalid video ID'),
});

// ============================================================================
// Report Schemas
// ============================================================================

export const exportReportQuerySchema = z.object({
  type: z.enum(['csv', 'pdf'], { required_error: 'Export type is required' }),
  reportType: z.enum(['drivers', 'trips', 'locations'], {
    required_error: 'Report type is required',
  }),
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
// Passenger / Customer Schemas
// ============================================================================

export const passengerRegisterSchema = z.object({
  email: z
    .string()
    .email('Valid email is required')
    .transform((value) => value.trim().toLowerCase()),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(1, 'Name is required'),
});

export const passengerLoginSchema = z.object({
  auth0Token: z.string().min(1, 'Auth0 token is required'),
  deviceId: z.string().optional(),
  deviceInfo: z.string().optional(),
});

export const passengerForgotPasswordSchema = z.object({
  email: z
    .string()
    .email('Valid email is required')
    .transform((value) => value.trim().toLowerCase()),
});

export const latitudeSchema = z
  .number()
  .min(-90, 'Latitude must be between -90 and 90')
  .max(90, 'Latitude must be between -90 and 90');
export const longitudeSchema = z
  .number()
  .min(-180, 'Longitude must be between -180 and 180')
  .max(180, 'Longitude must be between -180 and 180');

export const latitudeQuerySchema = z.coerce
  .number()
  .min(-90, 'Latitude must be between -90 and 90')
  .max(90, 'Latitude must be between -90 and 90');
export const longitudeQuerySchema = z.coerce
  .number()
  .min(-180, 'Longitude must be between -180 and 180')
  .max(180, 'Longitude must be between -180 and 180');

const coordinatePointSchema = z.object({
  latitude: latitudeSchema,
  longitude: longitudeSchema,
});

/** Flutter/Dart often sends explicit null for omitted optional strings. */
const nullishOptionalString = z.preprocess(
  (val) => (val === null || val === '' ? undefined : val),
  z.string().optional()
);

export const bookingQuoteSchema = z.object({
  serviceCategoryId: z.string().uuid().optional(),
  pickup: coordinatePointSchema.extend({
    address: z.string().optional(),
    spotLabel: nullishOptionalString,
  }),
  dropoff: coordinatePointSchema.extend({
    address: z.string().optional(),
    placeId: nullishOptionalString,
  }),
  stops: z
    .array(
      coordinatePointSchema.extend({
        address: z.string(),
        placeId: nullishOptionalString,
      })
    )
    .max(3)
    .optional()
    .default([]),
});

export const createBookingSchema = z
  .object({
    serviceCategoryId: z.string().uuid(),
    pickup: coordinatePointSchema.extend({
      address: z.string().min(1),
      spotLabel: nullishOptionalString,
    }),
    dropoff: coordinatePointSchema.extend({
      address: z.string().min(1),
      placeId: nullishOptionalString,
    }),
    stops: z
      .array(
        coordinatePointSchema.extend({
          address: z.string(),
          placeId: nullishOptionalString,
        })
      )
      .max(3)
      .optional()
      .default([]),
    paymentMethodCode: z.preprocess(
      (val) => (val === null || val === undefined || val === '' ? 'cash' : val),
      z.string().default('cash')
    ),
    schedulingType: z.enum(['instant', 'scheduled']).optional().default('instant'),
    scheduledPickupAt: z.string().datetime().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.schedulingType === 'scheduled') {
      if (!data.scheduledPickupAt) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'scheduledPickupAt is required for scheduled bookings',
          path: ['scheduledPickupAt'],
        });
        return;
      }
      const scheduledAt = new Date(data.scheduledPickupAt);
      if (Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'scheduledPickupAt must be a future date and time',
          path: ['scheduledPickupAt'],
        });
      }
    }
  });

export const cancelBookingSchema = z.object({
  reasonCode: z.string().max(100).optional(),
  reason: z.string().max(500).optional(),
});

export const bookingIdParamSchema = z.object({
  bookingId: z.string().uuid(),
});

export const bookingHistoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  filter: z.enum(['all', 'completed', 'cancelled']).optional().default('all'),
});

export const offerIdParamSchema = z.object({
  offerId: z.string().uuid(),
});

export const declineOfferSchema = z.object({
  offerId: z.string().uuid().optional(),
  reason: z.string().max(500).optional(),
});

export const driverCancelBookingSchema = z.object({
  reason: z.string().max(500).optional(),
});

export const driverBookingStatusSchema = z.object({
  status: z.enum(['driver_en_route', 'arrived', 'in_progress', 'completed']),
});

export const assignDriverCategorySchema = z.object({
  driverId: z.string().uuid(),
  serviceCategoryId: z.string().uuid(),
  isPrimary: z.boolean().optional(),
});

export const placesAutocompleteQuerySchema = z.object({
  input: z
    .string()
    .trim()
    .min(2, 'Search input must be at least 2 characters')
    .max(200, 'Search input is too long'),
  lat: latitudeQuerySchema.optional(),
  lng: longitudeQuerySchema.optional(),
  city: z.string().trim().max(100).optional(),
  country: z.string().trim().length(2).optional(),
  sessionToken: z.string().trim().max(256).optional(),
});

export const placeDetailsQuerySchema = z.object({
  placeId: z.string().trim().min(1, 'placeId is required').max(512),
  sessionToken: z.string().trim().max(256).optional(),
});

export const reverseGeocodeQuerySchema = z.object({
  lat: latitudeQuerySchema,
  lng: longitudeQuerySchema,
});

export const pickupSpotsQuerySchema = z.object({
  lat: latitudeQuerySchema,
  lng: longitudeQuerySchema,
  address: z.string().trim().max(500).optional(),
});

export const routePreviewSchema = z.object({
  pickup: coordinatePointSchema.extend({
    address: z.string().optional(),
    placeId: z.string().optional(),
  }),
  dropoff: coordinatePointSchema.extend({
    address: z.string().optional(),
    placeId: z.string().optional(),
  }),
  stops: z
    .array(
      coordinatePointSchema.extend({
        address: z.string().optional(),
        placeId: z.string().optional(),
      })
    )
    .max(3)
    .optional(),
  travelMode: z.enum(['DRIVE', 'TWO_WHEELER']).optional(),
  routePreference: z.enum(['TRAFFIC_AWARE', 'TRAFFIC_UNAWARE']).optional(),
});

export const savePlaceSchema = z.object({
  label: z.string().trim().min(1).max(255),
  address: z.string().trim().min(1).max(500),
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  placeId: z.string().trim().max(255).optional(),
  city: z.string().trim().max(255).optional(),
  countryCode: z.string().trim().length(2).optional(),
  placeType: z.enum(['home', 'work', 'favorite', 'recent']).default('recent'),
});

export const updatePlaceSchema = savePlaceSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field is required to update',
  });

export const placeIdParamSchema = z.object({
  placeId: z.string().uuid('Invalid place ID'),
});

export const nearbyDriversQuerySchema = z.object({
  lat: latitudeQuerySchema,
  lng: longitudeQuerySchema,
  serviceCategoryId: z.string().uuid(),
  radiusKm: z.coerce.number().min(0.5).max(30).optional(),
});

export const placeSuggestionsQuerySchema = z.object({
  lat: latitudeQuerySchema.optional(),
  lng: longitudeQuerySchema.optional(),
  limit: z.coerce.number().int().min(1).max(30).optional(),
});

export const liveVideoChunkSchema = z.object({
  sessionId: z.string().uuid(),
  segmentIndex: z.coerce.number().int().min(0),
  durationSeconds: z.coerce.number().optional(),
});

export const recordingConsentSchema = z.object({
  consent: z.boolean(),
  consentVersion: z.string().trim().min(1).max(50).optional(),
});

export const videoSessionParamSchema = z.object({
  sessionId: z.string().uuid('Invalid video session ID'),
});

export const videoSegmentParamSchema = z.object({
  sessionId: z.string().uuid('Invalid video session ID'),
  segmentId: z.string().uuid('Invalid video segment ID'),
});

export const videoSegmentIdParamSchema = z.object({
  segmentId: z.string().uuid('Invalid video segment ID'),
});

export const registerVideoSegmentSchema = z.object({
  clientSegmentId: z.string().uuid('clientSegmentId must be a UUID'),
  sequenceNumber: z.number().int().min(0),
  durationMs: z.number().int().min(0).optional(),
  fileSizeBytes: z.number().int().min(0).optional(),
  mimeType: z.enum(['video/mp4', 'video/quicktime']),
  recordedAt: z.string().datetime({ offset: true }).optional(),
  checksum: z
    .string()
    .regex(/^[a-fA-F0-9]{64}$/, 'checksum must be SHA-256 hex')
    .optional(),
});

export const completeVideoSegmentSchema = z.object({
  checksum: z
    .string()
    .regex(/^[a-fA-F0-9]{64}$/, 'checksum must be SHA-256 hex')
    .optional(),
  fileSizeBytes: z.number().int().min(0).optional(),
});

export const failVideoSegmentSchema = z.object({
  reason: z.string().trim().max(1000).optional(),
});

export const videoSegmentListQuerySchema = z.object({
  status: z.enum(['pending', 'uploading', 'uploaded', 'verified', 'failed']).optional(),
});

export const adminRideVideoListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  search: z.string().trim().max(200).optional(),
  bookingId: z.string().uuid().optional(),
  sessionId: z.string().uuid().optional(),
  driverId: z.string().uuid().optional(),
  passengerId: z.string().uuid().optional(),
  driverPhone: z.string().trim().max(50).optional(),
  passengerPhone: z.string().trim().max(50).optional(),
  vehicleRegistration: z.string().trim().max(50).optional(),
  bookingStatus: z.string().trim().max(50).optional(),
  recordingStatus: z.string().trim().max(50).optional(),
  consentStatus: z
    .enum(['not_required', 'pending', 'granted', 'denied', 'revoked', 'required'])
    .optional(),
  uploadHealth: z
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
  processingStatus: z.string().trim().max(50).optional(),
  retentionStatus: z.enum(['active', 'expiring_soon', 'expired', 'deleted']).optional(),
  serviceType: z.string().trim().max(100).optional(),
  dateFrom: z.string().datetime({ offset: true }).optional(),
  dateTo: z.string().datetime({ offset: true }).optional(),
  sortBy: z.enum(['createdAt', 'finalizedAt', 'startedAt', 'rideDate']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});

export const adminRideVideoSummaryQuerySchema = z.object({
  dateFrom: z.string().datetime({ offset: true }).optional(),
  dateTo: z.string().datetime({ offset: true }).optional(),
  driverId: z.string().uuid().optional(),
  passengerId: z.string().uuid().optional(),
});

export const adminRideVideoSegmentsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});

export const adminRideVideoAuditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const adminRideVideoPlaybackManifestSchema = z
  .object({
    fromIndex: z.coerce.number().int().min(0).optional(),
    fromSegmentIndex: z.coerce.number().int().min(0).optional(),
    fromOffsetSeconds: z.coerce.number().int().min(0).optional(),
    sinceManifestVersion: z.coerce.number().int().min(0).optional(),
    limit: z.coerce.number().int().min(1).max(30).optional(),
  })
  .optional()
  .default({});

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

export const validate = (schema: z.ZodSchema, source: 'body' | 'query' | 'params' = 'body') => {
  return (req: Request, res: Response, next: NextFunction): void => {
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
