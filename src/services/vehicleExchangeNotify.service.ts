import { emitToDriver } from './bookingNotify.service';

export async function emitExchangeRequested(
  partnerDriverId: string,
  payload: Record<string, unknown>
): Promise<void> {
  await emitToDriver(partnerDriverId, 'vehicle_exchange:requested', payload);
}

export async function emitExchangeCancelled(
  driverId: string,
  payload: Record<string, unknown>
): Promise<void> {
  await emitToDriver(driverId, 'vehicle_exchange:cancelled', payload);
}

export async function emitExchangeExpired(
  driverId: string,
  payload: Record<string, unknown>
): Promise<void> {
  await emitToDriver(driverId, 'vehicle_exchange:expired', payload);
}

export async function emitExchangeCompleted(
  driverId: string,
  payload: Record<string, unknown>
): Promise<void> {
  await emitToDriver(driverId, 'vehicle_exchange:completed', payload);
}

export async function emitVehicleAssignmentChanged(
  driverId: string,
  payload: Record<string, unknown>
): Promise<void> {
  await emitToDriver(driverId, 'vehicle_assignment:changed', payload);
}
