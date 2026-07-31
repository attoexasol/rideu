import { findExpiredPendingExchangeIds } from '../repositories/vehicleExchange.repository';
import { expireVehicleExchange } from './vehicleExchange.service';

const POLL_INTERVAL_MS = 15_000;

export async function processExpiredVehicleExchanges(): Promise<number> {
  const ids = await findExpiredPendingExchangeIds(50);
  let expired = 0;
  for (const id of ids) {
    const ok = await expireVehicleExchange(id);
    if (ok) expired += 1;
  }
  if (expired > 0) {
    console.log(`[VehicleExchangeExpiration] Expired ${expired} exchange(s)`);
  }
  return expired;
}

export function startVehicleExchangeExpirationPoller(): NodeJS.Timeout {
  return setInterval(() => {
    processExpiredVehicleExchanges().catch((err) =>
      console.error('[VehicleExchangeExpiration] Poll failed:', err)
    );
  }, POLL_INTERVAL_MS);
}
