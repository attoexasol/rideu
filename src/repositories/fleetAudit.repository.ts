import { db } from '../db/connection';
import { fleetAuditEvents } from '../db/schema/fleet_audit_events';

export type FleetAuditEventType =
  | 'duty_started'
  | 'duty_ended'
  | 'assignment_started'
  | 'assignment_ended'
  | 'qr_issued'
  | 'qr_revoked'
  | 'qr_rotated'
  | 'admin_override'
  | 'migration_backfill'
  | 'vehicle_updated';

export interface FleetAuditInput {
  eventType: FleetAuditEventType;
  actorType: 'driver' | 'admin' | 'system';
  actorId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  driverId?: string | null;
  vehicleId?: string | null;
  fleetId?: string | null;
  payload?: Record<string, unknown> | null;
}

export async function insertFleetAuditEvent(input: FleetAuditInput) {
  const [row] = await db
    .insert(fleetAuditEvents)
    .values({
      eventType: input.eventType,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      driverId: input.driverId ?? null,
      vehicleId: input.vehicleId ?? null,
      fleetId: input.fleetId ?? null,
      payload: input.payload ?? null,
    })
    .returning();
  return row;
}
