-- Rollback for 0027_stripe_payment_foundation
-- Does not modify bookings fare/status columns or delete cash payment_methods.

DROP TABLE IF EXISTS "booking_settlements";
DROP TABLE IF EXISTS "booking_payments";
DROP TABLE IF EXISTS "stripe_webhook_events";

DELETE FROM "payment_methods" WHERE "code" = 'card' AND "is_active" = false;
