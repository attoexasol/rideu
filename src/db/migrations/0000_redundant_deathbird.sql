CREATE TABLE "drivers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth0_id" varchar(255) NOT NULL,
	"email" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"phone" varchar(50),
	"status" varchar(50) DEFAULT 'offline' NOT NULL,
	"vehicle_id" uuid,
	"last_seen" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "drivers_auth0_id_unique" UNIQUE("auth0_id"),
	CONSTRAINT "drivers_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"latitude" numeric(10, 8) NOT NULL,
	"longitude" numeric(11, 8) NOT NULL,
	"accuracy" numeric(10, 2),
	"speed" numeric(10, 2),
	"heading" numeric(5, 2),
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"start_time" timestamp NOT NULL,
	"end_time" timestamp,
	"distance" numeric(10, 2),
	"status" varchar(50) DEFAULT 'in_progress' NOT NULL,
	"start_location_id" uuid,
	"end_location_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth0_id" varchar(255) NOT NULL,
	"email" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"role" varchar(50) DEFAULT 'admin' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "admin_users_auth0_id_unique" UNIQUE("auth0_id"),
	CONSTRAINT "admin_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"user_type" varchar(50) NOT NULL,
	"token" varchar(500) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"make" varchar(100),
	"model" varchar(100),
	"year" integer,
	"plate_number" varchar(50),
	"vin" varchar(17),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "vehicles_plate_number_unique" UNIQUE("plate_number"),
	CONSTRAINT "vehicles_vin_unique" UNIQUE("vin")
);
--> statement-breakpoint
CREATE TABLE "logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"user_id" uuid,
	"user_type" varchar(50),
	"message" text,
	"metadata" jsonb,
	"timestamp" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_start_location_id_locations_id_fk" FOREIGN KEY ("start_location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_end_location_id_locations_id_fk" FOREIGN KEY ("end_location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_drivers_status" ON "drivers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_drivers_auth0_id" ON "drivers" USING btree ("auth0_id");--> statement-breakpoint
CREATE INDEX "idx_locations_driver_id" ON "locations" USING btree ("driver_id");--> statement-breakpoint
CREATE INDEX "idx_locations_timestamp" ON "locations" USING btree ("timestamp" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_locations_driver_timestamp" ON "locations" USING btree ("driver_id","timestamp" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_trips_driver_id" ON "trips" USING btree ("driver_id");--> statement-breakpoint
CREATE INDEX "idx_trips_status" ON "trips" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_trips_start_time" ON "trips" USING btree ("start_time" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_admin_users_auth0_id" ON "admin_users" USING btree ("auth0_id");--> statement-breakpoint
CREATE INDEX "idx_sessions_token" ON "sessions" USING btree ("token");--> statement-breakpoint
CREATE INDEX "idx_sessions_user_id" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_sessions_expires_at" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_vehicles_plate_number" ON "vehicles" USING btree ("plate_number");--> statement-breakpoint
CREATE INDEX "idx_logs_event_type" ON "logs" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "idx_logs_timestamp" ON "logs" USING btree ("timestamp" DESC NULLS LAST);