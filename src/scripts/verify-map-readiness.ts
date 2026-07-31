import postgres from 'postgres';
import 'dotenv/config';

async function main() {
  const sql = postgres(process.env.DATABASE_URL!);
  try {
    const cols = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'bookings'
        AND column_name = 'route_encoded_polyline'
    `;
    const country = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'customer_places'
        AND column_name = 'country_code'
    `;
    const idem = await sql`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'booking_idempotency_keys'
        AND indexname = 'idx_booking_idempotency_customer_key'
    `;
    console.log(
      JSON.stringify(
        {
          route_encoded_polyline: cols.length > 0,
          customer_places_country_code: country.length > 0,
          idempotency_unique_index: idem.length > 0,
          google_maps_key_configured: Boolean(process.env.GOOGLE_MAPS_API_KEY?.trim()),
        },
        null,
        2
      )
    );
  } finally {
    await sql.end();
  }
}

main();
