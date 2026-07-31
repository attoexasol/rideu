-- Passenger booking system (RYD U)
CREATE TABLE IF NOT EXISTS "customers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "auth0_id" varchar(255) NOT NULL UNIQUE,
  "phone_country_code" varchar(10) NOT NULL,
  "phone_number" varchar(30) NOT NULL,
  "name" varchar(255) NOT NULL,
  "email" varchar(255),
  "profile_image_url" varchar(500),
  "status" varchar(50) DEFAULT 'active' NOT NULL,
  "phone_verified_at" timestamp,
  "active_session_id" varchar(255),
  "active_device_id" varchar(255),
  "active_device_info" varchar(500),
  "last_login_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_customers_auth0_id" ON "customers" ("auth0_id");
CREATE INDEX IF NOT EXISTS "idx_customers_phone" ON "customers" ("phone_country_code", "phone_number");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_customers_phone_unique" ON "customers" ("phone_country_code", "phone_number");

CREATE TABLE IF NOT EXISTS "service_categories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" varchar(50) NOT NULL UNIQUE,
  "name" varchar(100) NOT NULL,
  "description" varchar(500),
  "icon_key" varchar(100),
  "capacity" integer DEFAULT 1 NOT NULL,
  "base_fare" numeric(10, 2) NOT NULL,
  "per_km_rate" numeric(10, 2) NOT NULL,
  "min_fare" numeric(10, 2) NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "payment_methods" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" varchar(50) NOT NULL UNIQUE,
  "name" varchar(100) NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "promotions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" varchar(50),
  "title" varchar(100) NOT NULL,
  "discount_type" varchar(20) NOT NULL,
  "discount_value" numeric(10, 2) NOT NULL,
  "service_category_id" uuid REFERENCES "service_categories"("id") ON DELETE SET NULL,
  "valid_from" timestamp NOT NULL,
  "valid_until" timestamp NOT NULL,
  "max_uses_per_customer" integer,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "bookings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "booking_number" varchar(20) NOT NULL UNIQUE,
  "customer_id" uuid NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
  "service_category_id" uuid NOT NULL REFERENCES "service_categories"("id"),
  "status" varchar(50) DEFAULT 'quoted' NOT NULL,
  "scheduling_type" varchar(20) DEFAULT 'instant' NOT NULL,
  "scheduled_pickup_at" timestamp,
  "pickup_latitude" numeric(10, 8) NOT NULL,
  "pickup_longitude" numeric(11, 8) NOT NULL,
  "pickup_address" varchar(500) NOT NULL,
  "pickup_spot_label" varchar(255),
  "dropoff_latitude" numeric(10, 8) NOT NULL,
  "dropoff_longitude" numeric(11, 8) NOT NULL,
  "dropoff_address" varchar(500) NOT NULL,
  "dropoff_place_id" varchar(255),
  "estimated_distance_km" numeric(10, 2),
  "estimated_duration_min" integer,
  "estimated_fare" numeric(10, 2),
  "original_fare" numeric(10, 2),
  "promotion_id" uuid REFERENCES "promotions"("id") ON DELETE SET NULL,
  "discount_amount" numeric(10, 2),
  "final_fare" numeric(10, 2),
  "payment_method_id" uuid REFERENCES "payment_methods"("id"),
  "payment_status" varchar(50) DEFAULT 'pending' NOT NULL,
  "assigned_driver_id" uuid REFERENCES "drivers"("id") ON DELETE SET NULL,
  "assigned_vehicle_id" uuid REFERENCES "vehicles"("id") ON DELETE SET NULL,
  "linked_trip_id" uuid,
  "driver_eta_minutes" integer,
  "recording_consented_at" timestamp,
  "search_started_at" timestamp,
  "accepted_at" timestamp,
  "arrived_at" timestamp,
  "started_at" timestamp,
  "completed_at" timestamp,
  "cancelled_at" timestamp,
  "cancelled_by" varchar(50),
  "cancellation_reason" varchar(500),
  "share_token" varchar(64) UNIQUE,
  "dispatch_batch" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "customer_places" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "customer_id" uuid NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
  "label" varchar(255) NOT NULL,
  "address" varchar(500) NOT NULL,
  "latitude" numeric(10, 8) NOT NULL,
  "longitude" numeric(11, 8) NOT NULL,
  "place_id" varchar(255),
  "city" varchar(255),
  "place_type" varchar(50) DEFAULT 'recent' NOT NULL,
  "last_used_at" timestamp DEFAULT now() NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "driver_service_categories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "driver_id" uuid NOT NULL REFERENCES "drivers"("id") ON DELETE CASCADE,
  "service_category_id" uuid NOT NULL REFERENCES "service_categories"("id") ON DELETE CASCADE,
  "is_primary" boolean DEFAULT false NOT NULL,
  "verified_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_driver_service_categories_unique" ON "driver_service_categories" ("driver_id", "service_category_id");

CREATE TABLE IF NOT EXISTS "booking_stops" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "booking_id" uuid NOT NULL REFERENCES "bookings"("id") ON DELETE CASCADE,
  "stop_order" integer NOT NULL,
  "latitude" numeric(10, 8) NOT NULL,
  "longitude" numeric(11, 8) NOT NULL,
  "address" varchar(500) NOT NULL,
  "place_id" varchar(255)
);

CREATE TABLE IF NOT EXISTS "booking_offers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "booking_id" uuid NOT NULL REFERENCES "bookings"("id") ON DELETE CASCADE,
  "driver_id" uuid NOT NULL REFERENCES "drivers"("id") ON DELETE CASCADE,
  "status" varchar(50) DEFAULT 'pending' NOT NULL,
  "distance_to_pickup_km" numeric(10, 2),
  "offered_at" timestamp DEFAULT now() NOT NULL,
  "responded_at" timestamp,
  "expires_at" timestamp NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_booking_offers_unique" ON "booking_offers" ("booking_id", "driver_id");

CREATE TABLE IF NOT EXISTS "booking_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "booking_id" uuid NOT NULL REFERENCES "bookings"("id") ON DELETE CASCADE,
  "actor_type" varchar(50) NOT NULL,
  "actor_id" uuid,
  "event_type" varchar(100) NOT NULL,
  "payload" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "trips" ADD COLUMN IF NOT EXISTS "booking_id" uuid;
ALTER TABLE "trips" ADD COLUMN IF NOT EXISTS "customer_id" uuid REFERENCES "customers"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "idx_trips_booking_id" ON "trips" ("booking_id");
CREATE INDEX IF NOT EXISTS "idx_trips_customer_id" ON "trips" ("customer_id");

ALTER TABLE "bookings" ADD CONSTRAINT "bookings_linked_trip_id_trips_id_fk"
  FOREIGN KEY ("linked_trip_id") REFERENCES "trips"("id") ON DELETE SET NULL;
ALTER TABLE "trips" ADD CONSTRAINT "trips_booking_id_bookings_id_fk"
  FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS "video_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "trip_id" uuid NOT NULL REFERENCES "trips"("id") ON DELETE CASCADE,
  "booking_id" uuid REFERENCES "bookings"("id") ON DELETE SET NULL,
  "driver_id" uuid NOT NULL REFERENCES "drivers"("id") ON DELETE CASCADE,
  "status" varchar(50) DEFAULT 'active' NOT NULL,
  "started_at" timestamp DEFAULT now() NOT NULL,
  "ended_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "video_segments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "session_id" uuid NOT NULL REFERENCES "video_sessions"("id") ON DELETE CASCADE,
  "segment_index" integer NOT NULL,
  "video_url" text NOT NULL,
  "mime_type" text,
  "file_size" bigint,
  "duration_seconds" integer,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_bookings_customer_status" ON "bookings" ("customer_id", "status", "created_at");
CREATE INDEX IF NOT EXISTS "idx_bookings_driver_status" ON "bookings" ("assigned_driver_id", "status");
CREATE INDEX IF NOT EXISTS "idx_bookings_status" ON "bookings" ("status");

-- Seed payment method
INSERT INTO "payment_methods" ("code", "name")
VALUES ('cash', 'Cash')
ON CONFLICT ("code") DO NOTHING;

-- Seed service categories (no rentals)
INSERT INTO "service_categories" ("code", "name", "description", "icon_key", "capacity", "base_fare", "per_km_rate", "min_fare", "sort_order")
VALUES
  ('ride', 'Ride', 'Standard car rides', 'ride', 4, 50.00, 25.00, 80.00, 1),
  ('bike', 'Bike', 'Affordable rides in a bike', 'bike', 1, 30.00, 15.00, 50.00, 2),
  ('cng', 'CNG', 'Affordable, eco-friendly rides', 'cng', 4, 40.00, 20.00, 70.00, 3),
  ('moto', 'Moto', 'Affordable motorcycle rides', 'moto', 1, 35.00, 18.00, 55.00, 4),
  ('premium', 'Premium', 'Luxury experience', 'premium', 4, 120.00, 45.00, 200.00, 5),
  ('comfort', 'Comfort', 'Affordable luxury', 'comfort', 4, 80.00, 35.00, 150.00, 6)
ON CONFLICT ("code") DO NOTHING;

-- Default 30% promotion (matches UI)
INSERT INTO "promotions" ("title", "discount_type", "discount_value", "valid_from", "valid_until", "is_active")
SELECT '30% OFF', 'percent', 30.00, now() - interval '1 day', now() + interval '1 year', true
WHERE NOT EXISTS (SELECT 1 FROM "promotions" WHERE "title" = '30% OFF');
