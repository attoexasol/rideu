import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  varchar,
  integer,
  boolean,
  jsonb,
  timestamp,
  uniqueIndex,
  index,
  check,
} from 'drizzle-orm/pg-core';

/**
 * Versioned operating polygons. Bangladesh is never enforced in application
 * code. US enforcement stays off until an approved row is activated.
 * No Coronado coordinates are seeded here.
 */
export const serviceAreas = pgTable(
  'service_areas',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    marketCode: varchar('market_code', { length: 8 }).notNull(),
    code: varchar('code', { length: 64 }).notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    version: integer('version').notNull(),
    status: varchar('status', { length: 20 }).default('draft').notNull(),
    geometry: jsonb('geometry').notNull(),
    policy: varchar('policy', { length: 40 }).default('pickup_and_dropoff').notNull(),
    enforcementEnabled: boolean('enforcement_enabled').default(false).notNull(),
    sourceLabel: varchar('source_label', { length: 255 }),
    sourceUrl: varchar('source_url', { length: 1000 }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    codeVersionUnique: uniqueIndex('uq_service_areas_market_code_version').on(
      table.marketCode,
      table.code,
      table.version
    ),
    oneActiveVersion: uniqueIndex('uq_service_areas_one_active_version')
      .on(table.marketCode, table.code)
      .where(sql`${table.status} = 'active'`),
    marketStatusIdx: index('idx_service_areas_market_status').on(table.marketCode, table.status),
    statusCheck: check(
      'service_areas_status_check',
      sql`${table.status} in ('draft', 'active', 'retired')`
    ),
    policyCheck: check(
      'service_areas_policy_check',
      sql`${table.policy} = 'pickup_and_dropoff'`
    ),
    versionCheck: check('service_areas_version_check', sql`${table.version} > 0`),
  })
);

export type ServiceArea = typeof serviceAreas.$inferSelect;
export type NewServiceArea = typeof serviceAreas.$inferInsert;
