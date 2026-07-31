import { emitToDriver } from './bookingNotify.service';

export async function emitDutyStarted(
  driverId: string,
  payload: Record<string, unknown>
): Promise<void> {
  await emitToDriver(driverId, 'duty:started', payload);
}

export async function emitDutyEnded(
  driverId: string,
  payload: Record<string, unknown>
): Promise<void> {
  await emitToDriver(driverId, 'duty:ended', payload);
}
