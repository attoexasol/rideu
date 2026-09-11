import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';

/**
 * Stripe webhook delivery idempotency.
 * Full event payloads are not stored (card/PII risk).
 */
export const stripeWebhookEvents = pgTable(
  'stripe_webhook_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    stripeEventId: varchar('stripe_event_id', { length: 255 }).notNull(),
    eventType: varchar('event_type', { length: 100 }).notNull(),
    processingStatus: varchar('processing_status', { length: 30 }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    stripeEventUnique: uniqueIndex('uq_stripe_webhook_events_stripe_event_id').on(
      table.stripeEventId
    ),
    statusIdx: index('idx_stripe_webhook_events_processing_status').on(table.processingStatus),
    typeIdx: index('idx_stripe_webhook_events_event_type').on(table.eventType),
    statusCheck: check(
      'stripe_webhook_events_processing_status_check',
      sql`${table.processingStatus} in ('received', 'processed', 'failed')`
    ),
  })
);

export type StripeWebhookEvent = typeof stripeWebhookEvents.$inferSelect;
export type NewStripeWebhookEvent = typeof stripeWebhookEvents.$inferInsert;
