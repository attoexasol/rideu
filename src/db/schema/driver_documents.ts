import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { drivers } from './drivers';

/**
 * Current driver compliance documents (one row per driver per type).
 * Bytes live in private object storage; this table stores metadata only.
 */
export const driverDocuments = pgTable(
  'driver_documents',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => drivers.id, { onDelete: 'cascade' }),
    documentType: varchar('document_type', { length: 32 }).notNull(),
    originalFilename: varchar('original_filename', { length: 255 }).notNull(),
    mimeType: varchar('mime_type', { length: 100 }).notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    storageKey: text('storage_key').notNull(),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    driverTypeUnique: uniqueIndex('uq_driver_documents_driver_type').on(
      table.driverId,
      table.documentType
    ),
    driverIdx: index('idx_driver_documents_driver_id').on(table.driverId),
    typeCheck: check(
      'driver_documents_type_check',
      sql`${table.documentType} in ('driving_license', 'insurance')`
    ),
    sizeCheck: check('driver_documents_size_check', sql`${table.sizeBytes} > 0`),
  })
);

export type DriverDocument = typeof driverDocuments.$inferSelect;
export type NewDriverDocument = typeof driverDocuments.$inferInsert;
