ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "cab_name" varchar(255);--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "cab_number" varchar(100);--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "vehicle_make" varchar(100);--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "vehicle_model" varchar(100);--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "vehicle_year" varchar(4);--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "vehicle_color" varchar(50);
