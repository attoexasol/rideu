import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  decimal,
  integer,
  boolean,
  timestamp,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';

/**
 * Admin-editable settlement split. Only one row is active.
 * Commission only: driver_percentage + company_percentage = 100.
 * Airport fees are fixed amounts on airport records, not a settlement percentage.
 */
export const settlementSettings = pgTable(
  'settlement_settings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    driverPercentage: decimal('driver_percentage', { precision: 6, scale: 2 }).notNull(),
    companyPercentage: decimal('company_percentage', { precision: 6, scale: 2 }).notNull(),
    version: integer('version').notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    versionUnique: uniqueIndex('uq_settlement_settings_version').on(table.version),
    activeUnique: uniqueIndex('uq_settlement_settings_active')
      .on(table.isActive)
      .where(sql`${table.isActive} = true`),
    driverNonNegative: check(
      'settlement_settings_driver_percentage_check',
      sql`${table.driverPercentage} >= 0 AND ${table.driverPercentage} <= 100`
    ),
    companyNonNegative: check(
      'settlement_settings_company_percentage_check',
      sql`${table.companyPercentage} >= 0 AND ${table.companyPercentage} <= 100`
    ),
    totalCheck: check(
      'settlement_settings_commission_total_check',
      sql`${table.driverPercentage} + ${table.companyPercentage} = 100`
    ),
  })
);

export type SettlementSettings = typeof settlementSettings.$inferSelect;
export type NewSettlementSettings = typeof settlementSettings.$inferInsert;
