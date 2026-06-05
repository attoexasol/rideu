CREATE TYPE "public"."vehicle_type" AS ENUM('sedan', 'suv', 'van', 'mini_bus', 'coach_bus');--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN "vehicle_type" "vehicle_type";--> statement-breakpoint
CREATE INDEX "idx_drivers_vehicle_type" ON "drivers" USING btree ("vehicle_type");