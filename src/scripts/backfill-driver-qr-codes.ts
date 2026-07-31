/**
 * Backfill qr_code for existing drivers where qr_code IS NULL.
 *
 * Usage: npm run db:backfill-qr
 */

import 'dotenv/config';
import { closeConnection } from '../db/connection';
import { backfillMissingDriverQrCodes } from '../services/driverQrCode.service';

async function main() {
  console.log('🔄 Backfilling driver QR codes...');

  const result = await backfillMissingDriverQrCodes();

  console.log('✅ Backfill complete');
  console.log(`   Total without QR: ${result.total}`);
  console.log(`   Updated:          ${result.updated}`);
  console.log(`   Failed:           ${result.failed}`);

  if (result.errors.length > 0) {
    console.log('   Errors:');
    for (const err of result.errors) {
      console.log(`     - ${err.driverId}: ${err.message}`);
    }
  }

  await closeConnection();
  process.exit(result.failed > 0 ? 1 : 0);
}

main().catch(async (error) => {
  console.error('❌ Backfill failed:', error);
  await closeConnection();
  process.exit(1);
});
