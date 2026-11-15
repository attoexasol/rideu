import { Request, Response } from 'express';
import { sendSuccess, sendError } from '../utils/response';
import {
  listOrganizations,
  listFleets,
  findFleetById,
  ensurePlatformOrganizationAndFleet,
} from '../repositories/organization.repository';
import { db } from '../db/connection';
import { vehicles } from '../db/schema/vehicles';
import { eq } from 'drizzle-orm';
import {
  issueVehicleQrToken,
  revokeVehicleQrToken,
  rotateVehicleQrToken,
  getVehicleQrTokens,
  VehicleQrError,
} from '../services/vehicleQrToken.service';
import { assignDriverToFleet } from '../repositories/driverFleetMembership.repository';
import { getCurrentDuty, endDuty, driverHasActiveRide, DutyError } from '../services/duty.service';
import {
  findActiveAssignmentWithVehicle,
} from '../repositories/driverVehicleAssignment.repository';
import { generateQrImage } from '../utils/qrImage';
import {
  resolveAdminFleetScope,
  AdminFleetAccessError,
} from '../services/adminFleetAccess.service';
import { listAdminFleetVehiclesForAdmin } from '../services/adminFleetVehicle.service';
import {
  updateAdminFleetVehicle,
  AdminFleetVehicleUpdateError,
} from '../services/adminFleetVehicleUpdate.service';
import {
  resolveVehicleProfile,
  validateVehicleProfileForQr,
} from '../services/adminVehicleProfile.service';
import {
  loadLegacyDriverHintsForVehicles,
  vehicleHasServiceCategory,
} from '../repositories/adminVehicleEnrichment.repository';
import { APPROVED_VEHICLE_STATUSES } from '../config/duty';

function handleQrError(res: Response, err: unknown) {
  if (err instanceof VehicleQrError) {
    return sendError(res, err.code, err.message, err.statusCode);
  }
  if (err instanceof DutyError) {
    return sendError(res, err.code, err.message, err.statusCode);
  }
  throw err;
}

export async function listOrganizationsHandler(_req: Request, res: Response) {
  const orgs = await listOrganizations();
  return sendSuccess(res, orgs);
}

export async function listFleetsHandler(req: Request, res: Response) {
  const organizationId = req.query.organizationId as string | undefined;
  const fleetList = await listFleets(organizationId);
  return sendSuccess(res, fleetList);
}

export async function listAdminFleetVehiclesHandler(req: Request, res: Response) {
  const user = (req as Request & {
    user?: { role?: string; permissions?: string[]; fleetIds?: string[] };
  }).user;

  if (!user?.role) {
    return sendError(res, 'AUTH_FAILED', 'Authentication required', 401);
  }

  try {
    const scope = resolveAdminFleetScope(user);
    const data = await listAdminFleetVehiclesForAdmin(user, scope, {
      page: req.query.page ? Number(req.query.page) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      search: req.query.search as string | undefined,
      fleetId: req.query.fleetId as string | undefined,
      organizationId: req.query.organizationId as string | undefined,
      status: req.query.status as string | undefined,
      serviceCategoryId: req.query.serviceCategoryId as string | undefined,
      qrStatus: req.query.qrStatus as string | undefined,
      dutyStatus: req.query.dutyStatus as string | undefined,
    });
    return sendSuccess(res, data);
  } catch (err) {
    if (err instanceof AdminFleetAccessError) {
      return sendError(res, err.code, err.message, err.statusCode);
    }
    throw err;
  }
}

export async function listFleetVehiclesHandler(req: Request, res: Response) {
  const { fleetId } = req.params;
  const rows = await db.select().from(vehicles).where(eq(vehicles.fleetId, fleetId));
  return sendSuccess(res, rows);
}

export async function updateAdminFleetVehicleHandler(req: Request, res: Response) {
  const { vehicleId } = req.params;
  const user = (req as Request & {
    user?: { role?: string; permissions?: string[]; fleetIds?: string[]; userId?: string };
  }).user;

  if (!user?.role) {
    return sendError(res, 'AUTH_FAILED', 'Authentication required', 401);
  }

  try {
    const scope = resolveAdminFleetScope(user);
    const data = await updateAdminFleetVehicle(scope, vehicleId, req.body, user.userId ?? null);
    return sendSuccess(res, data);
  } catch (err) {
    if (err instanceof AdminFleetAccessError) {
      return sendError(res, err.code, err.message, err.statusCode);
    }
    if (err instanceof AdminFleetVehicleUpdateError) {
      return sendError(res, err.code, err.message, err.statusCode);
    }
    throw err;
  }
}

export async function issueVehicleQrHandler(req: Request, res: Response) {
  const { vehicleId } = req.params;
  const user = (req as Request & { user?: { userId?: string } }).user;
  try {
    const vehicleRows = await db.select().from(vehicles).where(eq(vehicles.id, vehicleId)).limit(1);
    const vehicle = vehicleRows[0];
    if (!vehicle) {
      return sendError(res, 'NOT_FOUND', 'Vehicle not found', 404);
    }
    if (!vehicle.fleetId) {
      return sendError(res, 'FLEET_MISMATCH', 'Vehicle has no fleet assignment', 400);
    }
    if (!APPROVED_VEHICLE_STATUSES.has(vehicle.status)) {
      return sendError(res, 'VEHICLE_NOT_APPROVED', 'Vehicle is not approved for QR issuance', 409);
    }

    const hints = await loadLegacyDriverHintsForVehicles([vehicleId]);
    const profile = resolveVehicleProfile(vehicle, hints.get(vehicleId));
    const hasCategory = await vehicleHasServiceCategory(vehicleId);
    const profileCheck = validateVehicleProfileForQr(profile, hasCategory);
    if (!profileCheck.valid) {
      return sendError(
        res,
        'VEHICLE_PROFILE_INCOMPLETE',
        `Vehicle profile incomplete: missing ${profileCheck.missing.join(', ')}`,
        409
      );
    }

    const token = await issueVehicleQrToken(vehicleId, vehicle.fleetId, user?.userId ?? null);
    const image = await generateQrImage(token.token, 'base64');
    return sendSuccess(res, { token, image }, 201);
  } catch (err) {
    return handleQrError(res, err);
  }
}

export async function revokeVehicleQrHandler(req: Request, res: Response) {
  const { tokenId } = req.params;
  const user = (req as Request & { user?: { userId?: string } }).user;
  try {
    const row = await revokeVehicleQrToken(tokenId, user?.userId ?? null, req.body.reason);
    return sendSuccess(res, row);
  } catch (err) {
    return handleQrError(res, err);
  }
}

export async function rotateVehicleQrHandler(req: Request, res: Response) {
  const { vehicleId } = req.params;
  const user = (req as Request & { user?: { userId?: string } }).user;
  try {
    const vehicleRows = await db.select().from(vehicles).where(eq(vehicles.id, vehicleId)).limit(1);
    const vehicle = vehicleRows[0];
    if (!vehicle?.fleetId) {
      return sendError(res, 'FLEET_MISMATCH', 'Vehicle has no fleet assignment', 400);
    }
    const token = await rotateVehicleQrToken(vehicleId, vehicle.fleetId, user?.userId ?? null);
    const image = await generateQrImage(token.token, 'base64');
    return sendSuccess(res, { token, image });
  } catch (err) {
    return handleQrError(res, err);
  }
}

export async function listVehicleQrTokensHandler(req: Request, res: Response) {
  const { vehicleId } = req.params;
  const vehicleRows = await db.select().from(vehicles).where(eq(vehicles.id, vehicleId)).limit(1);
  if (!vehicleRows[0]) {
    return sendError(res, 'NOT_FOUND', 'Vehicle not found', 404);
  }

  const tokens = await getVehicleQrTokens(vehicleId);
  const safeTokens = await Promise.all(
    tokens.map(async ({ token, ...meta }) => {
      if (meta.status !== 'active' && meta.status !== 'issued') {
        return meta;
      }
      try {
        const image = await generateQrImage(token, 'base64');
        return { ...meta, image };
      } catch {
        return meta;
      }
    })
  );
  return sendSuccess(res, { vehicleId, tokens: safeTokens });
}

export async function assignDriverFleetHandler(req: Request, res: Response) {
  const { driverId } = req.params;
  const { fleetId } = req.body;
  const membership = await assignDriverToFleet(driverId, fleetId);
  return sendSuccess(res, membership);
}

export async function inspectDriverDutyHandler(req: Request, res: Response) {
  const { driverId } = req.params;
  const duty = await getCurrentDuty(driverId);
  return sendSuccess(res, duty);
}

export async function inspectDriverAssignmentHandler(req: Request, res: Response) {
  const { driverId } = req.params;
  const assignment = await findActiveAssignmentWithVehicle(driverId);
  return sendSuccess(res, assignment);
}

export async function forceEndDutyHandler(req: Request, res: Response) {
  const { driverId } = req.params;
  const user = (req as Request & { user?: { userId?: string; role?: string } }).user;
  const emergency = req.body.emergency === true;
  const isSuperAdmin = user?.role?.toLowerCase() === 'super_admin';

  if (!emergency && (await driverHasActiveRide(driverId))) {
    return sendError(res, 'ACTIVE_RIDE_BLOCKS_DUTY_END', 'Active ride blocks duty end', 409);
  }
  if (emergency && !isSuperAdmin) {
    return sendError(res, 'UNAUTHORIZED', 'Emergency force-end requires super_admin', 403);
  }

  try {
    const data = await endDuty({
      driverId,
      reason: req.body.reason ?? 'admin_force_end',
      location: req.body.location,
      forced: true,
      adminId: user?.userId ?? null,
    });
    return sendSuccess(res, data);
  } catch (err) {
    return handleQrError(res, err);
  }
}

export async function ensurePlatformHandler(_req: Request, res: Response) {
  const platform = await ensurePlatformOrganizationAndFleet();
  const fleet = await findFleetById(platform.fleetId);
  return sendSuccess(res, { ...platform, fleet });
}
