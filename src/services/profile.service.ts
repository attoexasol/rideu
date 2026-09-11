import { db } from '../db/connection';
import { drivers } from '../db/schema/drivers';
import { eq } from 'drizzle-orm';
import { logger } from '../middleware/logger';
import { auth0Management } from './auth0Management';
import { normalizePhone } from '../utils/geo';
import { driverUtils, sessionUtils } from '../db/utils';
import { findActiveAssignmentWithVehicle } from '../repositories/driverVehicleAssignment.repository';
import {
  clearCustomerSession,
  findCustomerById,
  listCustomersForAdmin,
  updateCustomerProfile,
} from '../repositories/customer.repository';
import { invalidateDriverPushTargets } from './driverPushToken.service';
import { invalidatePassengerPushTargets } from './passengerPushToken.service';
import { endDuty, driverHasActiveRide, DutyError } from './duty.service';
import { realtimeCache } from '../config/redis';
import {
  ACCOUNT_STATUS_DEACTIVATED,
  assertAccountActive,
  isDeactivatedAccount,
} from './accountStatus.service';
import {
  AvatarRole,
  AvatarStorageError,
  deleteManagedAvatar,
  storeAvatar,
} from './avatar-storage.service';
import type { ProfilePatchInput, ProfilePhoneInput } from '../validators/profile';
import type { Customer } from '../db/schema/customers';
import type { Driver } from '../db/schema/drivers';

export class ProfileError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400
  ) {
    super(message);
    this.name = 'ProfileError';
  }
}

export interface VehicleSummaryDto {
  id: string;
  make: string | null;
  model: string | null;
  plateNumber: string | null;
  color: string | null;
}

export interface DriverProfileDto {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  profileImageUrl: string | null;
  accountStatus: string;
  createdAt: Date;
  vehicleSummary: VehicleSummaryDto | null;
}

export interface PassengerProfileDto {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  profileImageUrl: string | null;
  accountStatus: string;
  createdAt: Date;
}

export function formatPhoneDisplay(
  countryCode: string | null | undefined,
  phoneNumber: string | null | undefined
): string | null {
  if (!countryCode?.trim() || !phoneNumber?.trim()) return null;
  try {
    return normalizePhone(countryCode, phoneNumber).e164;
  } catch {
    const cc = countryCode.startsWith('+') ? countryCode : `+${countryCode}`;
    return `${cc}${phoneNumber.replace(/\D/g, '')}` || null;
  }
}

export function toDriverProfileDto(
  driver: Driver,
  vehicleSummary: VehicleSummaryDto | null
): DriverProfileDto {
  return {
    id: driver.id,
    name: driver.name,
    email: driver.email,
    phone: driver.phone ?? null,
    profileImageUrl: driver.profileImageUrl ?? null,
    accountStatus: driver.accountStatus ?? 'active',
    createdAt: driver.createdAt,
    vehicleSummary,
  };
}

export function toPassengerProfileDto(customer: Customer): PassengerProfileDto {
  return {
    id: customer.id,
    name: customer.name,
    email: customer.email,
    phone: formatPhoneDisplay(customer.phoneCountryCode, customer.phoneNumber),
    profileImageUrl: customer.profileImageUrl ?? null,
    accountStatus: customer.status,
    createdAt: customer.createdAt,
  };
}

function logProfile(event: string, role: string, userId: string, changedFields?: string[]) {
  logger.info({
    event,
    role,
    userId,
    changedFields: changedFields ?? [],
  });
}

async function resolveVehicleSummary(driverId: string): Promise<VehicleSummaryDto | null> {
  const row = await findActiveAssignmentWithVehicle(driverId);
  if (!row?.vehicle) return null;
  return {
    id: row.vehicle.id,
    make: row.vehicle.make ?? null,
    model: row.vehicle.model ?? null,
    plateNumber: row.vehicle.plateNumber ?? null,
    color: row.vehicle.color ?? null,
  };
}

export async function getDriverProfile(driverId: string): Promise<DriverProfileDto> {
  const driver = await db.query.drivers.findFirst({ where: eq(drivers.id, driverId) });
  if (!driver) {
    throw new ProfileError('NOT_FOUND', 'Driver not found', 404);
  }
  const vehicleSummary = await resolveVehicleSummary(driver.id);
  logProfile('profile.read', 'driver', driver.id);
  return toDriverProfileDto(driver, vehicleSummary);
}

export async function getPassengerProfile(customerId: string): Promise<PassengerProfileDto> {
  const customer = await findCustomerById(customerId);
  if (!customer) {
    throw new ProfileError('NOT_FOUND', 'Customer not found', 404);
  }
  logProfile('profile.read', 'customer', customer.id);
  return toPassengerProfileDto(customer);
}

async function persistAuth0NameThenDb(params: {
  auth0Id: string;
  name: string;
  apply: () => Promise<void>;
}): Promise<void> {
  if (!auth0Management.isConfigured()) {
    throw new ProfileError(
      'AUTH0_ERROR',
      'Auth0 Management API is not configured; name cannot be updated',
      503
    );
  }
  try {
    await auth0Management.updateUserName(params.auth0Id, params.name);
  } catch (error) {
    throw new ProfileError(
      'AUTH0_ERROR',
      error instanceof Error ? error.message : 'Failed to update name in Auth0',
      502
    );
  }
  await params.apply();
}

function normalizeOptionalPhone(phone: ProfilePhoneInput): {
  countryCode: string;
  phoneNumber: string;
  e164: string;
} {
  const normalized = normalizePhone(phone.countryCode, phone.number);
  if (normalized.phoneNumber.length < 4) {
    throw new ProfileError('VALIDATION_ERROR', 'Phone number is too short', 400);
  }
  return normalized;
}

export async function updateDriverProfile(
  driverId: string,
  patch: ProfilePatchInput
): Promise<DriverProfileDto> {
  const driver = await db.query.drivers.findFirst({ where: eq(drivers.id, driverId) });
  if (!driver) {
    throw new ProfileError('NOT_FOUND', 'Driver not found', 404);
  }

  const changedFields: string[] = [];
  const updateData: Partial<Driver> & { updatedAt: Date } = { updatedAt: new Date() };

  if (patch.phone !== undefined) {
    updateData.phone = patch.phone === null ? null : normalizeOptionalPhone(patch.phone).e164;
    changedFields.push('phone');
  }

  if (patch.name !== undefined && patch.name !== driver.name) {
    changedFields.push('name');
    await persistAuth0NameThenDb({
      auth0Id: driver.auth0Id,
      name: patch.name,
      apply: async () => {
        await db
          .update(drivers)
          .set({ ...updateData, name: patch.name })
          .where(eq(drivers.id, driverId));
      },
    });
  } else if (changedFields.length > 0) {
    await db.update(drivers).set(updateData).where(eq(drivers.id, driverId));
  }

  logProfile('profile.updated', 'driver', driverId, changedFields);
  return getDriverProfile(driverId);
}

export async function updatePassengerProfile(
  customerId: string,
  patch: ProfilePatchInput
): Promise<PassengerProfileDto> {
  const customer = await findCustomerById(customerId);
  if (!customer) {
    throw new ProfileError('NOT_FOUND', 'Customer not found', 404);
  }

  const changedFields: string[] = [];
  const dbPatch: {
    name?: string;
    phoneCountryCode?: string | null;
    phoneNumber?: string | null;
  } = {};

  if (patch.phone !== undefined) {
    if (patch.phone === null) {
      dbPatch.phoneCountryCode = null;
      dbPatch.phoneNumber = null;
    } else {
      const normalized = normalizeOptionalPhone(patch.phone);
      dbPatch.phoneCountryCode = normalized.countryCode;
      dbPatch.phoneNumber = normalized.phoneNumber;
    }
    changedFields.push('phone');
  }

  if (patch.name !== undefined && patch.name !== customer.name) {
    changedFields.push('name');
    await persistAuth0NameThenDb({
      auth0Id: customer.auth0Id,
      name: patch.name,
      apply: async () => {
        await updateCustomerProfile(customerId, { ...dbPatch, name: patch.name });
      },
    });
  } else if (changedFields.length > 0) {
    await updateCustomerProfile(customerId, dbPatch);
  }

  logProfile('profile.updated', 'customer', customerId, changedFields);
  return getPassengerProfile(customerId);
}

async function replaceAvatar(params: {
  role: AvatarRole;
  currentUrl: string | null | undefined;
  buffer: Buffer;
  declaredMime?: string;
}): Promise<string> {
  const stored = await storeAvatar({
    role: params.role,
    buffer: params.buffer,
    declaredMime: params.declaredMime,
  });
  try {
    await deleteManagedAvatar(params.currentUrl, params.role);
  } catch (error) {
    logger.info({
      event: 'profile.avatar_replaced_old_delete_failed',
      role: params.role,
      message: error instanceof Error ? error.message : 'unknown',
    });
  }
  return stored.profileImageUrl;
}

export async function uploadDriverAvatar(
  driverId: string,
  buffer: Buffer,
  declaredMime?: string
): Promise<{ profileImageUrl: string }> {
  const driver = await db.query.drivers.findFirst({ where: eq(drivers.id, driverId) });
  if (!driver) {
    throw new ProfileError('NOT_FOUND', 'Driver not found', 404);
  }
  const profileImageUrl = await replaceAvatar({
    role: 'drivers',
    currentUrl: driver.profileImageUrl,
    buffer,
    declaredMime,
  });
  await db
    .update(drivers)
    .set({ profileImageUrl, updatedAt: new Date() })
    .where(eq(drivers.id, driverId));
  logProfile('profile.avatar_uploaded', 'driver', driverId, ['profileImageUrl']);
  return { profileImageUrl };
}

export async function uploadPassengerAvatar(
  customerId: string,
  buffer: Buffer,
  declaredMime?: string
): Promise<{ profileImageUrl: string }> {
  const customer = await findCustomerById(customerId);
  if (!customer) {
    throw new ProfileError('NOT_FOUND', 'Customer not found', 404);
  }
  const profileImageUrl = await replaceAvatar({
    role: 'passengers',
    currentUrl: customer.profileImageUrl,
    buffer,
    declaredMime,
  });
  await updateCustomerProfile(customerId, { profileImageUrl });
  logProfile('profile.avatar_uploaded', 'customer', customerId, ['profileImageUrl']);
  return { profileImageUrl };
}

export async function removeDriverAvatar(driverId: string): Promise<{ profileImageUrl: null }> {
  const driver = await db.query.drivers.findFirst({ where: eq(drivers.id, driverId) });
  if (!driver) {
    throw new ProfileError('NOT_FOUND', 'Driver not found', 404);
  }
  await deleteManagedAvatar(driver.profileImageUrl, 'drivers');
  await db
    .update(drivers)
    .set({ profileImageUrl: null, updatedAt: new Date() })
    .where(eq(drivers.id, driverId));
  logProfile('profile.avatar_removed', 'driver', driverId, ['profileImageUrl']);
  return { profileImageUrl: null };
}

export async function removePassengerAvatar(
  customerId: string
): Promise<{ profileImageUrl: null }> {
  const customer = await findCustomerById(customerId);
  if (!customer) {
    throw new ProfileError('NOT_FOUND', 'Customer not found', 404);
  }
  await deleteManagedAvatar(customer.profileImageUrl, 'passengers');
  await updateCustomerProfile(customerId, { profileImageUrl: null });
  logProfile('profile.avatar_removed', 'customer', customerId, ['profileImageUrl']);
  return { profileImageUrl: null };
}

export async function deactivateDriverAccount(driverId: string): Promise<{ accountStatus: string }> {
  const driver = await db.query.drivers.findFirst({ where: eq(drivers.id, driverId) });
  if (!driver) {
    throw new ProfileError('NOT_FOUND', 'Driver not found', 404);
  }

  const hasRide = await driverHasActiveRide(driverId);
  if (!hasRide) {
    try {
      await endDuty({ driverId, reason: 'account_deactivated' });
    } catch (error) {
      if (!(error instanceof DutyError) || error.code !== 'DRIVER_NOT_ON_DUTY') {
        throw error;
      }
      await db
        .update(drivers)
        .set({ status: 'offline', updatedAt: new Date() })
        .where(eq(drivers.id, driverId));
      await realtimeCache.setDriverStatus(driverId, 'offline');
    }
  }

  // Stripe connected accounts belong to the driver's financial identity.
  // Logout, session invalidation, and deactivation must not delete or detach them.
  await db
    .update(drivers)
    .set({
      accountStatus: ACCOUNT_STATUS_DEACTIVATED,
      updatedAt: new Date(),
    })
    .where(eq(drivers.id, driverId));

  await driverUtils.clearSessionInfo(driverId);
  await sessionUtils.deleteAllForUser(driverId);
  await invalidateDriverPushTargets(driverId);

  logProfile('profile.deactivated', 'driver', driverId, ['accountStatus']);
  return { accountStatus: ACCOUNT_STATUS_DEACTIVATED };
}

export async function deactivatePassengerAccount(
  customerId: string
): Promise<{ accountStatus: string }> {
  const customer = await findCustomerById(customerId);
  if (!customer) {
    throw new ProfileError('NOT_FOUND', 'Customer not found', 404);
  }

  await updateCustomerProfile(customerId, { status: ACCOUNT_STATUS_DEACTIVATED });
  await clearCustomerSession(customerId);
  await sessionUtils.deleteAllForUser(customerId);
  try {
    await invalidatePassengerPushTargets(customerId);
  } catch (error) {
    logger.warn({
      event: 'passenger.push.failed',
      customerId,
      pushAttempted: false,
      pushSent: false,
      pushFailureCode: 'ISOLATED_EXCEPTION',
      message: error instanceof Error ? error.message : 'unknown',
    });
  }

  logProfile('profile.deactivated', 'customer', customerId, ['accountStatus']);
  return { accountStatus: ACCOUNT_STATUS_DEACTIVATED };
}

export function mapAdminPassenger(row: {
  id: string;
  name: string;
  email: string;
  phoneCountryCode: string | null;
  phoneNumber: string | null;
  profileImageUrl: string | null;
  status: string;
  createdAt: Date;
}) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: formatPhoneDisplay(row.phoneCountryCode, row.phoneNumber),
    profileImageUrl: row.profileImageUrl,
    accountStatus: row.status,
    createdAt: row.createdAt,
  };
}

export async function listAdminPassengers(params: {
  page: number;
  limit: number;
  search?: string;
}) {
  const { rows, total } = await listCustomersForAdmin(params);
  return {
    passengers: rows.map(mapAdminPassenger),
    total,
  };
}

export async function getAdminPassenger(id: string) {
  const customer = await findCustomerById(id);
  if (!customer) {
    throw new ProfileError('NOT_FOUND', 'Passenger not found', 404);
  }
  return mapAdminPassenger(customer);
}

export { assertAccountActive, isDeactivatedAccount, AvatarStorageError };
