-- Eligible stopped time for the test-only meter fare.
-- Live charging stays disabled. These counters do not release a production charge.

ALTER TABLE "meter_sessions" ADD COLUMN IF NOT EXISTS "excluded_stop_seconds" integer DEFAULT 0 NOT NULL;
ALTER TABLE "meter_sessions" ADD COLUMN IF NOT EXISTS "stop_streak" integer DEFAULT 0 NOT NULL;
ALTER TABLE "meter_sessions" ADD COLUMN IF NOT EXISTS "stop_remainder_ms" integer DEFAULT 0 NOT NULL;

ALTER TABLE "meter_sessions" DROP CONSTRAINT IF EXISTS "meter_sessions_stop_check";
ALTER TABLE "meter_sessions" ADD CONSTRAINT "meter_sessions_stop_check"
  CHECK (
    "excluded_stop_seconds" >= 0
    AND "stop_streak" >= 0
    AND "stop_remainder_ms" >= 0
    AND "stop_remainder_ms" < 1000
  );
