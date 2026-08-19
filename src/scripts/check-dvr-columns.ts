import postgres from 'postgres';
import * as dotenv from 'dotenv';

dotenv.config();

async function main() {
  const DATABASE_URL =
    process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ryd_u';
  const sql = postgres(DATABASE_URL, { max: 1 });

  const cols = await sql`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'video_sessions'
      AND column_name IN ('manifest_version', 'last_upload_activity_at')
    ORDER BY column_name
  `;
  console.log('COLUMNS:', JSON.stringify(cols, null, 2));

  const migrations = await sql`
    SELECT id, hash, created_at
    FROM drizzle.__drizzle_migrations
    ORDER BY created_at
  `;
  console.log('MIGRATION_COUNT:', migrations.length);
  console.log('LAST_MIGRATION:', migrations[migrations.length - 1]);

  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
