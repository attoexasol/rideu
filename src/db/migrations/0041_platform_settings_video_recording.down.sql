-- Dropping the table makes the recording policy read as missing, which the
-- backend treats as OFF.
DROP TABLE IF EXISTS "platform_settings";
