-- Driver ride history: newest-first by created_at for an assigned driver.
CREATE INDEX IF NOT EXISTS "idx_bookings_driver_created_at"
  ON "bookings" ("assigned_driver_id", "created_at" DESC, "id" DESC);
