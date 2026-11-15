import { emitToAdmins, emitToCustomer, emitToDriver } from '../bookingNotify.service';
import { MeterSocketEvent } from '../../constants/softMeter';

export async function emitMeterUpdate(
  input: {
    driverId: string;
    customerId?: string | null;
    payload: unknown;
    kind: 'state' | 'fare';
  }
): Promise<void> {
  const event = input.kind === 'fare' ? MeterSocketEvent.FARE : MeterSocketEvent.STATE;
  await emitToDriver(input.driverId, event, input.payload);
  if (input.customerId) {
    await emitToCustomer(input.customerId, event, input.payload);
  }
  if (input.kind === 'state') {
    await emitToAdmins(event, input.payload);
  }
}

export async function emitWalkUpPayment(
  driverId: string,
  payload: unknown
): Promise<void> {
  await emitToDriver(driverId, MeterSocketEvent.PAYMENT, payload);
  await emitToAdmins(MeterSocketEvent.PAYMENT, payload);
}

export async function emitBookingMeterPayment(input: {
  customerId: string;
  driverId?: string | null;
  payload: unknown;
}): Promise<void> {
  await emitToCustomer(input.customerId, MeterSocketEvent.BOOKING_PAYMENT, input.payload);
  if (input.driverId) {
    await emitToDriver(input.driverId, MeterSocketEvent.BOOKING_PAYMENT, input.payload);
  }
  await emitToAdmins(MeterSocketEvent.BOOKING_PAYMENT, input.payload);
}
