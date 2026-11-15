import type { DriverServiceAreaDecision } from '../serviceArea.service';
import { MeterError } from './errors';

export interface WalkUpEligibilityInput {
  accountActive: boolean;
  dutyRequired: boolean;
  onDuty: boolean;
  vehicleId: string | null;
  vehicleApproved: boolean;
  activeBooking: boolean;
  openWalkUp: boolean;
  openMeter: boolean;
  serviceArea: DriverServiceAreaDecision;
}

export function assertWalkUpEligible(input: WalkUpEligibilityInput): void {
  if (!input.accountActive) {
    throw new MeterError('ACCOUNT_DEACTIVATED', 'This account has been deactivated.', 403);
  }
  if (input.dutyRequired && !input.onDuty) {
    throw new MeterError(
      'DRIVER_NOT_ON_DUTY',
      'Driver must have an active duty session and vehicle assignment.',
      409
    );
  }
  if (!input.vehicleId || !input.vehicleApproved) {
    throw new MeterError(
      'VEHICLE_NOT_APPROVED',
      'An approved assigned vehicle is required for a walk-up trip.',
      409
    );
  }
  if (input.activeBooking || input.openWalkUp || input.openMeter) {
    throw new MeterError(
      'DRIVER_BUSY',
      'Driver already has an active trip or meter.',
      409
    );
  }
  if (input.serviceArea.applies && !input.serviceArea.inside) {
    throw new MeterError(
      input.serviceArea.code,
      input.serviceArea.code === 'OUTSIDE_SERVICE_AREA'
        ? 'Pickup is outside the service area.'
        : 'Service area is unavailable.',
      input.serviceArea.code === 'SERVICE_AREA_UNAVAILABLE' ? 503 : 400
    );
  }
}
