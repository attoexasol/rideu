import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  varchar,
  decimal,
  integer,
  timestamp,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { customers } from './customers';
import { drivers } from './drivers';
import { vehicles } from './vehicles';
import { serviceCategories } from './service_categories';
import { promotions } from './promotions';
import { paymentMethods } from './payment_methods';
import { airports } from './airports';

export const bookings = pgTable(
  'bookings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    bookingNumber: varchar('booking_number', { length: 20 }).notNull().unique(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    serviceCategoryId: uuid('service_category_id')
      .notNull()
      .references(() => serviceCategories.id),
    status: varchar('status', { length: 50 }).default('quoted').notNull(),
    schedulingType: varchar('scheduling_type', { length: 20 }).default('instant').notNull(),
    scheduledPickupAt: timestamp('scheduled_pickup_at'),
    pickupLatitude: decimal('pickup_latitude', { precision: 10, scale: 8 }).notNull(),
    pickupLongitude: decimal('pickup_longitude', { precision: 11, scale: 8 }).notNull(),
    pickupAddress: varchar('pickup_address', { length: 500 }).notNull(),
    pickupSpotLabel: varchar('pickup_spot_label', { length: 255 }),
    pickupPlaceId: varchar('pickup_place_id', { length: 255 }),
    dropoffLatitude: decimal('dropoff_latitude', { precision: 10, scale: 8 }).notNull(),
    dropoffLongitude: decimal('dropoff_longitude', { precision: 11, scale: 8 }).notNull(),
    dropoffAddress: varchar('dropoff_address', { length: 500 }).notNull(),
    dropoffPlaceId: varchar('dropoff_place_id', { length: 255 }),
    estimatedDistanceKm: decimal('estimated_distance_km', { precision: 10, scale: 2 }),
    estimatedDurationMin: integer('estimated_duration_min'),
    estimatedFare: decimal('estimated_fare', { precision: 10, scale: 2 }),
    originalFare: decimal('original_fare', { precision: 10, scale: 2 }),
    promotionId: uuid('promotion_id').references(() => promotions.id, { onDelete: 'set null' }),
    discountAmount: decimal('discount_amount', { precision: 10, scale: 2 }),
    finalFare: decimal('final_fare', { precision: 10, scale: 2 }),
    currency: varchar('currency', { length: 10 }).default('BDT').notNull(),
    marketCode: varchar('market_code', { length: 8 }),
    pickupCountryCode: varchar('pickup_country_code', { length: 2 }),
    regularTripFare: decimal('regular_trip_fare', { precision: 10, scale: 2 }),
    airportFeeAmount: decimal('airport_fee_amount', { precision: 10, scale: 2 }).default('0').notNull(),
    airportId: uuid('airport_id').references(() => airports.id, { onDelete: 'set null' }),
    airportCodeSnapshot: varchar('airport_code_snapshot', { length: 16 }),
    airportNameSnapshot: varchar('airport_name_snapshot', { length: 255 }),
    airportTripType: varchar('airport_trip_type', { length: 20 }),
    paymentMethodId: uuid('payment_method_id').references(() => paymentMethods.id),
    paymentStatus: varchar('payment_status', { length: 50 }).default('pending').notNull(),
    billingMode: varchar('billing_mode', { length: 40 }),
    assignedDriverId: uuid('assigned_driver_id').references(() => drivers.id, {
      onDelete: 'set null',
    }),
    assignedVehicleId: uuid('assigned_vehicle_id').references(() => vehicles.id, {
      onDelete: 'set null',
    }),
    linkedTripId: uuid('linked_trip_id'),
    driverEtaMinutes: integer('driver_eta_minutes'),
    recordingConsentedAt: timestamp('recording_consented_at', { withTimezone: true }),
    recordingConsentStatus: varchar('recording_consent_status', { length: 30 })
      .default('required')
      .notNull(),
    recordingConsentRevokedAt: timestamp('recording_consent_revoked_at', { withTimezone: true }),
    recordingConsentVersion: varchar('recording_consent_version', { length: 50 }).default('v1'),
    searchStartedAt: timestamp('search_started_at'),
    acceptedAt: timestamp('accepted_at'),
    arrivedAt: timestamp('arrived_at'),
    startedAt: timestamp('started_at'),
    completedAt: timestamp('completed_at'),
    cancelledAt: timestamp('cancelled_at'),
    cancelledBy: varchar('cancelled_by', { length: 50 }),
    cancellationReason: varchar('cancellation_reason', { length: 500 }),
    shareToken: varchar('share_token', { length: 64 }).unique(),
    routeEncodedPolyline: varchar('route_encoded_polyline', { length: 8192 }),
    dispatchBatch: integer('dispatch_batch').default(0).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    customerStatusIdx: index('idx_bookings_customer_status').on(
      table.customerId,
      table.status,
      table.createdAt
    ),
    driverStatusIdx: index('idx_bookings_driver_status').on(table.assignedDriverId, table.status),
    driverCreatedAtIdx: index('idx_bookings_driver_created_at').on(
      table.assignedDriverId,
      table.createdAt.desc(),
      table.id.desc()
    ),
    statusIdx: index('idx_bookings_status').on(table.status),
    scheduledIdx: index('idx_bookings_scheduled').on(table.scheduledPickupAt),
    shareTokenIdx: index('idx_bookings_share_token').on(table.shareToken),
    recordingConsentStatusCheck: check(
      'bookings_recording_consent_status_check',
      sql`${table.recordingConsentStatus} in ('required', 'granted', 'denied', 'not_required')`
    ),
    airportTripTypeCheck: check(
      'bookings_airport_trip_type_check',
      sql`${table.airportTripType} is null or ${table.airportTripType} in ('pickup', 'dropoff')`
    ),
    currencyCheck: check(
      'bookings_currency_check',
      sql`${table.currency} in ('BDT', 'USD')`
    ),
    billingModeCheck: check(
      'bookings_billing_mode_check',
      sql`${table.billingMode} is null or ${table.billingMode} in ('metered_post_trip', 'quoted_prepay')`
    ),
    airportIdx: index('idx_bookings_airport_id').on(table.airportId),
  })
);

export type Booking = typeof bookings.$inferSelect;
export type NewBooking = typeof bookings.$inferInsert;
