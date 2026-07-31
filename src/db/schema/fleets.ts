import { pgTable, uuid, varchar, timestamp, index } from 'drizzle-orm/pg-core';
import { organizations } from './organizations';

export const fleets = pgTable(
  'fleets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    name: varchar('name', { length: 255 }).notNull(),
    status: varchar('status', { length: 50 }).notNull().default('active'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    orgIdx: index('idx_fleets_organization_id').on(table.organizationId),
  })
);

export type Fleet = typeof fleets.$inferSelect;
export type NewFleet = typeof fleets.$inferInsert;
