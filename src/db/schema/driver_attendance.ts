import { pgTable, uuid, varchar, timestamp, text, index } from 'drizzle-orm/pg-core';
import { drivers } from './drivers';

export const driverAttendance = pgTable(
  'driver_attendance',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => drivers.id, { onDelete: 'cascade' }),
    checkInTime: timestamp('check_in_time').defaultNow().notNull(),
    checkOutTime: timestamp('check_out_time'),
    location: text('location'),
    status: varchar('status', { length: 50 }).notNull(),
  },
  (table) => ({
    driverIdx: index('idx_da_driver_id').on(table.driverId),
    statusIdx: index('idx_da_status').on(table.status),
  })
);

export type DriverAttendanceRecord = typeof driverAttendance.$inferSelect;
export type NewDriverAttendanceRecord = typeof driverAttendance.$inferInsert;
