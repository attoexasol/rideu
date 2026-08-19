-- Driver FCM registration tokens. device_id is the app UUID, not the FCM token.
CREATE TABLE IF NOT EXISTS "driver_push_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "driver_id" uuid NOT NULL,
  "device_id" varchar(255) NOT NULL,
  "session_id" varchar(255),
  "fcm_token" text NOT NULL,
  "enabled" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "last_registered_at" timestamp NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'driver_push_tokens_driver_id_drivers_id_fk'
  ) THEN
    ALTER TABLE "driver_push_tokens"
      ADD CONSTRAINT "driver_push_tokens_driver_id_drivers_id_fk"
      FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "idx_driver_push_tokens_driver_device"
  ON "driver_push_tokens" ("driver_id", "device_id");

CREATE UNIQUE INDEX IF NOT EXISTS "idx_driver_push_tokens_fcm_token"
  ON "driver_push_tokens" ("fcm_token");

CREATE INDEX IF NOT EXISTS "idx_driver_push_tokens_driver_id"
  ON "driver_push_tokens" ("driver_id");

CREATE INDEX IF NOT EXISTS "idx_driver_push_tokens_device_id"
  ON "driver_push_tokens" ("device_id");
