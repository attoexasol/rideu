import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  varchar,
  decimal,
  integer,
  boolean,
  bigint,
  jsonb,
  timestamp,
  uniqueIndex,
  index,
  check,
} from 'drizzle-orm/pg-core';

export const airports = pgTable(
  'airports',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    code: varchar('code', { length: 16 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    googlePlaceId: varchar('google_place_id', { length: 255 }),
    countryCode: varchar('country_code', { length: 2 }).notNull(),
    currency: varchar('currency', { length: 10 }).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    geofenceType: varchar('geofence_type', { length: 20 }).default('radius').notNull(),
    centerLatitude: decimal('center_latitude', { precision: 10, scale: 8 }).notNull(),
    centerLongitude: decimal('center_longitude', { precision: 11, scale: 8 }).notNull(),
    radiusMeters: integer('radius_meters').notNull(),
    geofencePolygon: jsonb('geofence_polygon'),
    pickupFeeMinor: bigint('pickup_fee_minor', { mode: 'number' }).notNull(),
    dropoffFeeMinor: bigint('dropoff_fee_minor', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    codeUnique: uniqueIndex('uq_airports_code').on(table.code),
    placeIdUnique: uniqueIndex('uq_airports_google_place_id')
      .on(table.googlePlaceId)
      .where(sql`${table.googlePlaceId} is not null`),
    activeIdx: index('idx_airports_active').on(table.isActive),
    geofenceTypeCheck: check(
      'airports_geofence_type_check',
      sql`${table.geofenceType} in ('radius', 'polygon')`
    ),
    radiusCheck: check('airports_radius_meters_check', sql`${table.radiusMeters} > 0`),
    pickupFeeCheck: check('airports_pickup_fee_minor_check', sql`${table.pickupFeeMinor} >= 0`),
    dropoffFeeCheck: check('airports_dropoff_fee_minor_check', sql`${table.dropoffFeeMinor} >= 0`),
  })
);

export type Airport = typeof airports.$inferSelect;
export type NewAirport = typeof airports.$inferInsert;
