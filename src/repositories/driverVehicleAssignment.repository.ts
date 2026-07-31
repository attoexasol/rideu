import { db } from '../db/connection';
import { driverVehicleAssignments } from '../db/schema/driver_vehicle_assignments';
import { drivers } from '../db/schema/drivers';
import { vehicles } from '../db/schema/vehicles';
import { eq, and, sql } from 'drizzle-orm';

export interface AssignmentRecord {
  id: string;
  driver_id: string;
  vehicle_id: string;
  fleet_id: string | null;
  duty_session_id: string | null;
  assigned_at: Date;
  unassigned_at: Date | null;
  is_active: boolean;
  assigned_by: string | null;
  assignment_reason: string | null;
  unassigned_reason: string | null;
  predecessor_assignment_id: string | null;
  exchange_request_id: string | null;
}

function mapAssignment(row: typeof driverVehicleAssignments.$inferSelect): AssignmentRecord {
  return {
    id: row.id,
    driver_id: row.driverId,
    vehicle_id: row.vehicleId,
    fleet_id: row.fleetId,
    duty_session_id: row.dutySessionId,
    assigned_at: row.assignedAt,
    unassigned_at: row.unassignedAt,
    is_active: row.isActive,
    assigned_by: row.assignedBy,
    assignment_reason: row.assignmentReason,
    unassigned_reason: row.unassignedReason,
    predecessor_assignment_id: row.predecessorAssignmentId,
    exchange_request_id: row.exchangeRequestId,
  };
}

export async function findActiveAssignmentByDriverId(
  driverId: string
): Promise<AssignmentRecord | null> {
  const rows = await db
    .select()
    .from(driverVehicleAssignments)
    .where(
      and(
        eq(driverVehicleAssignments.driverId, driverId),
        eq(driverVehicleAssignments.isActive, true)
      )
    )
    .limit(1);
  return rows[0] ? mapAssignment(rows[0]) : null;
}

export async function findActiveAssignmentByVehicleId(
  vehicleId: string
): Promise<AssignmentRecord | null> {
  const rows = await db
    .select()
    .from(driverVehicleAssignments)
    .where(
      and(
        eq(driverVehicleAssignments.vehicleId, vehicleId),
        eq(driverVehicleAssignments.isActive, true)
      )
    )
    .limit(1);
  return rows[0] ? mapAssignment(rows[0]) : null;
}

export async function deactivateAssignment(
  assignmentId: string,
  unassignedReason: string
): Promise<AssignmentRecord | null> {
  const [row] = await db
    .update(driverVehicleAssignments)
    .set({
      isActive: false,
      unassignedAt: new Date(),
      unassignedReason,
    })
    .where(eq(driverVehicleAssignments.id, assignmentId))
    .returning();
  return row ? mapAssignment(row) : null;
}

export async function createAssignment(
  data: typeof driverVehicleAssignments.$inferInsert
): Promise<AssignmentRecord> {
  const [row] = await db.insert(driverVehicleAssignments).values(data).returning();
  if (!row) throw new Error('Failed to create vehicle assignment');
  return mapAssignment(row);
}

export async function syncDriverVehicleId(driverId: string, vehicleId: string | null) {
  await db
    .update(drivers)
    .set({ vehicleId, updatedAt: new Date() })
    .where(eq(drivers.id, driverId));
}

export async function findActiveAssignmentWithVehicle(driverId: string) {
  const rows = await db
    .select({
      assignment: driverVehicleAssignments,
      vehicle: vehicles,
    })
    .from(driverVehicleAssignments)
    .innerJoin(vehicles, eq(vehicles.id, driverVehicleAssignments.vehicleId))
    .where(
      and(
        eq(driverVehicleAssignments.driverId, driverId),
        eq(driverVehicleAssignments.isActive, true)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

export interface DuplicateVehicleAssignment {
  vehicle_id: string;
  driver_ids: string[];
}

export async function findDuplicateVehicleAssignments(): Promise<DuplicateVehicleAssignment[]> {
  const rows = await db.execute(sql`
    SELECT vehicle_id, array_agg(driver_id::text) AS driver_ids
    FROM driver_vehicle_assignments
    WHERE is_active = true
    GROUP BY vehicle_id
    HAVING COUNT(*) > 1
  `);
  return rows as unknown as DuplicateVehicleAssignment[];
}

export async function findDuplicateDriverVehicleIds(): Promise<
  { vehicle_id: string; driver_ids: string[] }[]
> {
  const rows = await db.execute(sql`
    SELECT vehicle_id, array_agg(id::text) AS driver_ids
    FROM drivers
    WHERE vehicle_id IS NOT NULL
    GROUP BY vehicle_id
    HAVING COUNT(*) > 1
  `);
  return rows as unknown as { vehicle_id: string; driver_ids: string[] }[];
}

export async function findDuplicateActiveDutySessions(): Promise<
  { driver_id: string; count: number }[]
> {
  const rows = await db.execute(sql`
    SELECT driver_id, COUNT(*)::int AS count
    FROM duty_sessions
    WHERE status = 'active'
    GROUP BY driver_id
    HAVING COUNT(*) > 1
  `);
  return rows as unknown as { driver_id: string; count: number }[];
}
