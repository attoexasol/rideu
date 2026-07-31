import 'dotenv/config';

import { closeConnection } from '../db/connection';

import { backfillMissingDriverVehicleQrCodes } from '../services/vehicleQrCode.service';

async function main() {
  console.log('🔄 Backfilling driver vehicle QR codes...');

  const result = await backfillMissingDriverVehicleQrCodes();

  console.log('✅ Backfill complete');

  console.log(`   Total without vehicle QR: ${result.total}`);

  console.log(`   Updated:                  ${result.updated}`);

  console.log(`   Failed:                   ${result.failed}`);

  if (result.errors.length) {
    for (const e of result.errors) {
      console.log(`     - ${e.driverId}: ${e.message}`);
    }
  }

  await closeConnection();

  process.exit(result.failed > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);

  await closeConnection();

  process.exit(1);
});
