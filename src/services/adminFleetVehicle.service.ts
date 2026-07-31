import {
  ADMIN_FLEET_VEHICLE_LIST_DEFAULT_LIMIT,
  ADMIN_FLEET_VEHICLE_LIST_MAX_LIMIT,
} from '../config/adminFleet';
import { APPROVED_VEHICLE_STATUSES } from '../config/duty';
import {
  countAdminFleetVehicles,
  listAdminFleetVehicles,
  loadActiveQrForVehicles,
  loadAssignmentsForVehicles,
  loadDutyForDrivers,
  loadServiceCategoriesForVehicles,
  type AdminFleetVehicleListFilters,
} from '../repositories/adminFleetVehicle.repository';
import {
  fleetIdsForQuery,
  type AdminFleetScope,
  type AdminFleetUser,
} from './adminFleetAccess.service';
import { loadLegacyDriverHintsForVehicles } from '../repositories/adminVehicleEnrichment.repository';
import { resolveVehicleProfile } from './adminVehicleProfile.service';

export interface ListAdminFleetVehiclesQuery {
  page?: number;
  limit?: number;
  search?: string;
  fleetId?: string;
  organizationId?: string;
  status?: string;
  serviceCategoryId?: string;
  qrStatus?: string;
  dutyStatus?: string;
}

function mapApprovalStatus(status: string): string {
  if (APPROVED_VEHICLE_STATUSES.has(status)) return 'approved';
  return status;
}

function resolveCapacity(
  categories: { isPrimary: boolean; capacity: number }[]
): number | null {
  if (!categories.length) return null;
  const primary = categories.find((c) => c.isPrimary);
  return primary?.capacity ?? categories[0].capacity;
}

export async function listAdminFleetVehiclesForAdmin(
  _user: AdminFleetUser,
  scope: AdminFleetScope,
  query: ListAdminFleetVehiclesQuery
) {
  const page = Math.max(1, query.page ?? 1);
  const requestedLimit = query.limit ?? ADMIN_FLEET_VEHICLE_LIST_DEFAULT_LIMIT;
  const limit = Math.min(Math.max(1, requestedLimit), ADMIN_FLEET_VEHICLE_LIST_MAX_LIMIT);

  const fleetIds = fleetIdsForQuery(scope, query.fleetId);

  const filters: AdminFleetVehicleListFilters = {
    fleetIds,
    organizationId: query.organizationId,
    status: query.status,
    search: query.search,
    serviceCategoryId: query.serviceCategoryId,
    qrStatus: query.qrStatus,
    dutyStatus: query.dutyStatus,
    page,
    limit,
  };

  const [total, rows] = await Promise.all([
    countAdminFleetVehicles(filters),
    listAdminFleetVehicles(filters),
  ]);

  const vehicleIds = rows.map((r) => r.vehicle.id);

  const [assignments, qrMap, categoriesMap, legacyHints] = await Promise.all([
    loadAssignmentsForVehicles(vehicleIds),
    loadActiveQrForVehicles(vehicleIds),
    loadServiceCategoriesForVehicles(vehicleIds),
    loadLegacyDriverHintsForVehicles(vehicleIds),
  ]);

  const driverIds = [...assignments.values()].map((a) => a.driverId);
  const dutyMap = await loadDutyForDrivers(driverIds);

  const vehicles = rows.map(({ vehicle, fleet, organization }) => {
    const assignment = assignments.get(vehicle.id);
    const duty = assignment ? dutyMap.get(assignment.driverId) : undefined;
    const qr = qrMap.get(vehicle.id);
    const serviceCategories = categoriesMap.get(vehicle.id) ?? [];
    const profile = resolveVehicleProfile(vehicle, legacyHints.get(vehicle.id));

    return {
      id: vehicle.id,
      make: profile.make,
      model: profile.model,
      displayName: profile.displayName,
      plateNumber: profile.plateNumber,
      year: profile.year,
      color: profile.color,
      capacity: resolveCapacity(serviceCategories),
      fleetId: vehicle.fleetId,
      status: vehicle.status,
      approvalStatus: mapApprovalStatus(vehicle.status),
      organization: organization
        ? { id: organization.id, name: organization.name }
        : null,
      fleet: fleet ? { id: fleet.id, name: fleet.name } : null,
      serviceCategories,
      currentAssignment: assignment
        ? {
            driverId: assignment.driverId,
            driverName: assignment.driverName,
            assignmentId: assignment.assignmentId,
          }
        : null,
      currentDuty: duty
        ? {
            status: duty.status,
            dutySessionId: duty.dutySessionId,
          }
        : null,
      qr: {
        hasActiveToken: Boolean(qr),
        status: qr?.status ?? 'not_issued',
        tokenId: qr?.tokenId ?? null,
      },
    };
  });

  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

  return {
    vehicles,
    pagination: {
      page,
      limit,
      total,
      totalPages,
    },
  };
}
