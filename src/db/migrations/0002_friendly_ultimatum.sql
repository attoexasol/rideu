ALTER TABLE "drivers" ADD COLUMN "active_device_id" varchar(255);--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN "active_device_info" varchar(500);--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN "last_login_at" timestamp;