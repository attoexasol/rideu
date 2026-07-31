import { db } from '../db/connection';
import { vehicles } from '../db/schema/vehicles';
import { fleets } from '../db/schema/fleets';
import { organizations } from '../db/schema/organizations';
import { drivers } from '../db/schema/drivers';
import { driverVehicleAssignments } from '../db/schema/driver_vehicle_assignments';
import { dutySessions } from '../db/schema/duty_sessions';
import { vehicleQrTokens } from '../db/schema/vehicle_qr_tokens';
import { vehicleServiceCategories } from '../db/schema/vehicle_service_categories';
import { serviceCategories } from '../db/schema/service_categories';
import {
  and,
  eq,
  inArray,
  or,
  ilike,
  sql,
  count,
  asc,
  type SQL,
} from 'drizzle-orm';

export interface AdminFleetVehicleListFilters {
  fleetIds?: string[] | null;
  organizationId?: string;
  status?: string;
  search?: string;
  serviceCategoryId?: string;
  qrStatus?: string;
  dutyStatus?: string;
  page: number;
  limit: number;
}

export interface AdminFleetVehicleRow {
  vehicle: typeof vehicles.$inferSelect;
  fleet: typeof fleets.$inferSelect | null;
  organization: typeof organizations.$inferSelect | null;
}

function buildVehicleFilterConditions(filters: AdminFleetVehicleListFilters): SQL[] {
  const conditions: SQL[] = [];

  if (filters.fleetIds?.length) {
    conditions.push(inArray(vehicles.fleetId, filters.fleetIds));
  }

  if (filters.organizationId) {
    conditions.push(eq(fleets.organizationId, filters.organizationId));
  }

  if (filters.status) {
    conditions.push(eq(vehicles.status, filters.status));
  }

  if (filters.search) {
    const term = `%${filters.search.trim()}%`;
    conditions.push(
      or(
        ilike(vehicles.plateNumber, term),
        ilike(vehicles.make, term),
        ilike(vehicles.model, term),
        ilike(vehicles.bodyNumber, term),
        ilike(vehicles.vin, term)
      )!
    );
  }

  if (filters.serviceCategoryId) {
    conditions.push(
      sql`EXISTS (
        SELECT 1 FROM ${vehicleServiceCategories}
        WHERE ${vehicleServiceCategories.vehicleId} = ${vehicles.id}
          AND ${vehicleServiceCategories.serviceCategoryId} = ${filters.serviceCategoryId}
      )`
    );
  }

  if (filters.qrStatus === 'active') {
    conditions.push(
      sql`EXISTS (
        SELECT 1 FROM ${vehicleQrTokens}
        WHERE ${vehicleQrTokens.vehicleId} = ${vehicles.id}
          AND ${vehicleQrTokens.status} = 'active'
      )`
    );
  } else if (filters.qrStatus === 'none') {
    conditions.push(
      sql`NOT EXISTS (
        SELECT 1 FROM ${vehicleQrTokens}
        WHERE ${vehicleQrTokens.vehicleId} = ${vehicles.id}
          AND ${vehicleQrTokens.status} = 'active'
      )`
    );
  } else if (filters.qrStatus === 'revoked') {
    conditions.push(
      sql`EXISTS (
        SELECT 1 FROM ${vehicleQrTokens}
        WHERE ${vehicleQrTokens.vehicleId} = ${vehicles.id}
          AND ${vehicleQrTokens.status} = 'revoked'
      ) AND NOT EXISTS (
        SELECT 1 FROM ${vehicleQrTokens} vqt2
        WHERE vqt2.vehicle_id = ${vehicles.id}
          AND vqt2.status = 'active'
      )`
    );
  }

  if (filters.dutyStatus === 'on_duty') {
    conditions.push(
      sql`EXISTS (
        SELECT 1 FROM ${driverVehicleAssignments} dva
        INNER JOIN ${dutySessions} ds ON ds.id = dva.duty_session_id
        WHERE dva.vehicle_id = ${vehicles.id}
          AND dva.is_active = true
          AND ds.status = 'active'
      )`
    );
  } else if (filters.dutyStatus === 'off_duty') {
    conditions.push(
      sql`NOT EXISTS (
        SELECT 1 FROM ${driverVehicleAssignments} dva
        INNER JOIN ${dutySessions} ds ON ds.id = dva.duty_session_id
        WHERE dva.vehicle_id = ${vehicles.id}
          AND dva.is_active = true
          AND ds.status = 'active'
      )`
    );
  }

  return conditions;
}

export async function countAdminFleetVehicles(filters: AdminFleetVehicleListFilters): Promise<number> {
  const conditions = buildVehicleFilterConditions(filters);
  const whereClause = conditions.length ? and(...conditions) : undefined;

  const [row] = await db
    .select({ total: count() })
    .from(vehicles)
    .leftJoin(fleets, eq(vehicles.fleetId, fleets.id))
    .where(whereClause);

  return Number(row?.total ?? 0);
}

export async function listAdminFleetVehicles(
  filters: AdminFleetVehicleListFilters
): Promise<AdminFleetVehicleRow[]> {
  const conditions = buildVehicleFilterConditions(filters);
  const whereClause = conditions.length ? and(...conditions) : undefined;
  const offset = (filters.page - 1) * filters.limit;

  return db
    .select({
      vehicle: vehicles,
      fleet: fleets,
      organization: organizations,
    })
    .from(vehicles)
    .leftJoin(fleets, eq(vehicles.fleetId, fleets.id))
    .leftJoin(organizations, eq(fleets.organizationId, organizations.id))
    .where(whereClause)
    .orderBy(asc(vehicles.plateNumber), asc(vehicles.createdAt))
    .limit(filters.limit)
    .offset(offset);
}

export async function loadAssignmentsForVehicles(vehicleIds: string[]) {
  if (!vehicleIds.length) return new Map<string, { assignmentId: string; driverId: string; driverName: string }>();

  const rows = await db
    .select({
      vehicleId: driverVehicleAssignments.vehicleId,
      assignmentId: driverVehicleAssignments.id,
      driverId: drivers.id,
      driverName: drivers.name,
    })
    .from(driverVehicleAssignments)
    .innerJoin(drivers, eq(drivers.id, driverVehicleAssignments.driverId))
    .where(
      and(
        inArray(driverVehicleAssignments.vehicleId, vehicleIds),
        eq(driverVehicleAssignments.isActive, true)
      )
    );

  const map = new Map<string, { assignmentId: string; driverId: string; driverName: string }>();
  for (const row of rows) {
    map.set(row.vehicleId, {
      assignmentId: row.assignmentId,
      driverId: row.driverId,
      driverName: row.driverName,
    });
  }
  return map;
}

export async function loadDutyForDrivers(driverIds: string[]) {
  if (!driverIds.length) return new Map<string, { dutySessionId: string; status: string }>();

  const rows = await db
    .select({
      driverId: dutySessions.driverId,
      dutySessionId: dutySessions.id,
      status: dutySessions.status,
    })
    .from(dutySessions)
    .where(and(inArray(dutySessions.driverId, driverIds), eq(dutySessions.status, 'active')));

  const map = new Map<string, { dutySessionId: string; status: string }>();
  for (const row of rows) {
    map.set(row.driverId, { dutySessionId: row.dutySessionId, status: row.status });
  }
  return map;
}

export async function loadActiveQrForVehicles(vehicleIds: string[]) {
  if (!vehicleIds.length) return new Map<string, { tokenId: string; status: string }>();

  const rows = await db
    .select({
      vehicleId: vehicleQrTokens.vehicleId,
      tokenId: vehicleQrTokens.id,
      status: vehicleQrTokens.status,
    })
    .from(vehicleQrTokens)
    .where(
      and(inArray(vehicleQrTokens.vehicleId, vehicleIds), eq(vehicleQrTokens.status, 'active'))
    );

  const map = new Map<string, { tokenId: string; status: string }>();
  for (const row of rows) {
    map.set(row.vehicleId, { tokenId: row.tokenId, status: row.status });
  }
  return map;
}

export interface VehicleServiceCategoryDetail {
  id: string;
  code: string;
  name: string;
  isPrimary: boolean;
  capacity: number;
}

export async function loadServiceCategoriesForVehicles(vehicleIds: string[]) {
  if (!vehicleIds.length) return new Map<string, VehicleServiceCategoryDetail[]>();

  const rows = await db
    .select({
      vehicleId: vehicleServiceCategories.vehicleId,
      id: serviceCategories.id,
      code: serviceCategories.code,
      name: serviceCategories.name,
      isPrimary: vehicleServiceCategories.isPrimary,
      capacity: serviceCategories.capacity,
    })
    .from(vehicleServiceCategories)
    .innerJoin(
      serviceCategories,
      eq(serviceCategories.id, vehicleServiceCategories.serviceCategoryId)
    )
    .where(inArray(vehicleServiceCategories.vehicleId, vehicleIds));

  const map = new Map<string, VehicleServiceCategoryDetail[]>();
  for (const row of rows) {
    const list = map.get(row.vehicleId) ?? [];
    list.push({
      id: row.id,
      code: row.code,
      name: row.name,
      isPrimary: row.isPrimary,
      capacity: row.capacity,
    });
    map.set(row.vehicleId, list);
  }
  return map;
}
