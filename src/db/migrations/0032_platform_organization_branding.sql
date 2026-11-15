-- Idempotent display-name update for the platform organization.
-- Identifies the row by type = 'platform' (stable discriminator).
-- Does not change organization IDs, fleet IDs, slugs, or API field names.
-- Changing seed/bootstrap source does not update existing rows without this statement.

UPDATE "organizations"
SET "name" = 'DriveWize Platform',
    "updated_at" = NOW()
WHERE "type" = 'platform'
  AND "name" = 'RYDU Platform';
