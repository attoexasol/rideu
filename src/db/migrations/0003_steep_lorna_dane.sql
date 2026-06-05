ALTER TABLE "drivers" ADD COLUMN "active_session_id" varchar(255);--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN "last_heartbeat" timestamp;--> statement-breakpoint
CREATE INDEX "idx_drivers_last_heartbeat" ON "drivers" USING btree ("last_heartbeat");--> statement-breakpoint
CREATE INDEX "idx_drivers_active_session" ON "drivers" USING btree ("active_session_id");