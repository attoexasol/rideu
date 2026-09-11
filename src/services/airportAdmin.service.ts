import { normalizeCurrencyCode } from '../constants/payment';
import { PaymentError } from './payment.errors';
import { assertAirportCompatibleWithMarket } from './rideMarket.service';
import {
  findAirportByCode,
  findAirportByGooglePlaceId,
  findAirportById,
  insertAirport,
  listAirports,
  updateAirport,
} from '../repositories/airport.repository';
import { majorToMinorUnits, minorToMajorString } from '../utils/money';
import type { Airport, NewAirport } from '../db/schema/airports';

export class AirportConfigError extends PaymentError {
  constructor(code: string, message: string, statusCode = 400) {
    super(code, message, statusCode);
    this.name = 'AirportConfigError';
  }
}

function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

async function assertAirportActivationAllowed(input: {
  countryCode: string;
  currency: string;
  isActive: boolean;
}) {
  try {
    await assertAirportCompatibleWithMarket(input);
  } catch (error) {
    if (error instanceof PaymentError) {
      throw new AirportConfigError(error.code, error.message, error.statusCode);
    }
    throw error;
  }
}

function parseFeeMajorToMinor(value: string | number, label: string): number {
  try {
    const minor = majorToMinorUnits(typeof value === 'number' && !Number.isInteger(value) ? String(value) : value);
    if (minor < 0) {
      throw new AirportConfigError('INVALID_AIRPORT_FEE', `${label} must not be negative`);
    }
    return minor;
  } catch (error) {
    if (error instanceof AirportConfigError) throw error;
    throw new AirportConfigError(
      'INVALID_AIRPORT_FEE',
      `${label} must be a non-negative amount with at most 2 decimal places`
    );
  }
}

export function formatAirportAdmin(row: Airport) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    googlePlaceId: row.googlePlaceId,
    countryCode: row.countryCode,
    currency: row.currency,
    isActive: row.isActive,
    geofenceType: row.geofenceType,
    latitude: parseFloat(row.centerLatitude),
    longitude: parseFloat(row.centerLongitude),
    radiusMeters: row.radiusMeters,
    pickupFee: {
      minor: row.pickupFeeMinor,
      formatted: minorToMajorString(row.pickupFeeMinor),
      currency: row.currency,
    },
    dropoffFee: {
      minor: row.dropoffFeeMinor,
      formatted: minorToMajorString(row.dropoffFeeMinor),
      currency: row.currency,
    },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listAirportsForAdmin() {
  const rows = await listAirports(true);
  return rows.map(formatAirportAdmin);
}

export async function getAirportForAdmin(id: string) {
  const row = await findAirportById(id);
  if (!row) {
    throw new AirportConfigError('AIRPORT_NOT_FOUND', 'Airport not found', 404);
  }
  return formatAirportAdmin(row);
}

export async function createAirportForAdmin(input: {
  code: string;
  name: string;
  googlePlaceId?: string | null;
  countryCode: string;
  currency: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  pickupFee: string | number;
  dropoffFee: string | number;
  isActive?: boolean;
}) {
  const code = normalizeCode(input.code);
  if (!/^[A-Z0-9]{2,16}$/.test(code)) {
    throw new AirportConfigError('INVALID_AIRPORT_CODE', 'Airport code must be 2–16 letters or digits');
  }
  const existingCode = await findAirportByCode(code);
  if (existingCode) {
    throw new AirportConfigError('DUPLICATE_AIRPORT_CODE', 'Airport code already exists', 409);
  }
  const placeId = input.googlePlaceId?.trim() || null;
  if (placeId) {
    const existingPlace = await findAirportByGooglePlaceId(placeId);
    if (existingPlace) {
      throw new AirportConfigError('DUPLICATE_AIRPORT_PLACE_ID', 'Google Place ID already exists', 409);
    }
  }
  if (input.radiusMeters <= 0) {
    throw new AirportConfigError('INVALID_AIRPORT_RADIUS', 'radiusMeters must be greater than 0');
  }

  const currency = normalizeCurrencyCode(input.currency);
  const isActive = input.isActive ?? true;
  await assertAirportActivationAllowed({ countryCode: input.countryCode, currency, isActive });

  const row = await insertAirport({
    code,
    name: input.name.trim(),
    googlePlaceId: placeId,
    countryCode: input.countryCode.toUpperCase(),
    currency,
    isActive,
    geofenceType: 'radius',
    centerLatitude: String(input.latitude),
    centerLongitude: String(input.longitude),
    radiusMeters: input.radiusMeters,
    pickupFeeMinor: parseFeeMajorToMinor(input.pickupFee, 'pickupFee'),
    dropoffFeeMinor: parseFeeMajorToMinor(input.dropoffFee, 'dropoffFee'),
  });
  return formatAirportAdmin(row);
}

export async function updateAirportForAdmin(
  id: string,
  input: {
    code?: string;
    name?: string;
    googlePlaceId?: string | null;
    countryCode?: string;
    currency?: string;
    latitude?: number;
    longitude?: number;
    radiusMeters?: number;
    pickupFee?: string | number;
    dropoffFee?: string | number;
    isActive?: boolean;
  }
) {
  const current = await findAirportById(id);
  if (!current) {
    throw new AirportConfigError('AIRPORT_NOT_FOUND', 'Airport not found', 404);
  }

  const patch: Partial<NewAirport> = {};
  if (input.code != null) {
    const code = normalizeCode(input.code);
    if (!/^[A-Z0-9]{2,16}$/.test(code)) {
      throw new AirportConfigError('INVALID_AIRPORT_CODE', 'Airport code must be 2–16 letters or digits');
    }
    const existingCode = await findAirportByCode(code);
    if (existingCode && existingCode.id !== id) {
      throw new AirportConfigError('DUPLICATE_AIRPORT_CODE', 'Airport code already exists', 409);
    }
    patch.code = code;
  }
  if (input.name != null) patch.name = input.name.trim();
  if (input.googlePlaceId !== undefined) {
    const placeId = input.googlePlaceId?.trim() || null;
    if (placeId) {
      const existingPlace = await findAirportByGooglePlaceId(placeId, id);
      if (existingPlace) {
        throw new AirportConfigError('DUPLICATE_AIRPORT_PLACE_ID', 'Google Place ID already exists', 409);
      }
    }
    patch.googlePlaceId = placeId;
  }
  if (input.countryCode != null) patch.countryCode = input.countryCode.toUpperCase();
  if (input.currency != null) patch.currency = normalizeCurrencyCode(input.currency);
  const nextCurrency = (patch.currency as string | undefined) ?? current.currency;
  const nextActive = input.isActive ?? current.isActive;
  await assertAirportActivationAllowed({
    countryCode: (patch.countryCode as string | undefined) ?? current.countryCode,
    currency: nextCurrency,
    isActive: nextActive,
  });
  if (input.latitude != null) patch.centerLatitude = String(input.latitude);
  if (input.longitude != null) patch.centerLongitude = String(input.longitude);
  if (input.radiusMeters != null) {
    if (input.radiusMeters <= 0) {
      throw new AirportConfigError('INVALID_AIRPORT_RADIUS', 'radiusMeters must be greater than 0');
    }
    patch.radiusMeters = input.radiusMeters;
  }
  if (input.pickupFee != null) patch.pickupFeeMinor = parseFeeMajorToMinor(input.pickupFee, 'pickupFee');
  if (input.dropoffFee != null) patch.dropoffFeeMinor = parseFeeMajorToMinor(input.dropoffFee, 'dropoffFee');
  if (input.isActive != null) patch.isActive = input.isActive;

  const row = await updateAirport(id, patch);
  if (!row) {
    throw new AirportConfigError('AIRPORT_NOT_FOUND', 'Airport not found', 404);
  }
  return formatAirportAdmin(row);
}
