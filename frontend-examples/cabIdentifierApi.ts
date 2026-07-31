import type { CabFieldType, CabIdentifierValue } from './CabIdentifierField';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export interface CreateDriverPayload {
  email: string;
  password: string;
  name: string;
  role: 'driver';
  phone?: string;
  cabName?: string;
  cabFieldType?: CabFieldType;
  cabValue?: string;
  vehicleMake?: string;
  vehicleModel?: string;
  vehicleYear?: string;
  vehicleColor?: string;
}

export interface ApiError {
  success: false;
  error: { code: string; message: string; details?: unknown };
}

function buildCabPayload(cab: CabIdentifierValue): Pick<CreateDriverPayload, 'cabFieldType' | 'cabValue'> {
  const trimmed = cab.cabValue.trim();
  if (!trimmed) {
    return {};
  }
  return {
    cabFieldType: cab.cabFieldType,
    cabValue: trimmed,
  };
}

/** Create driver via POST /api/admin/users */
export async function createDriverUser(
  token: string,
  form: Omit<CreateDriverPayload, 'cabFieldType' | 'cabValue'> & { cab: CabIdentifierValue }
) {
  const { cab, ...rest } = form;
  const response = await fetch(`${API_BASE}/api/admin/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      ...rest,
      role: 'driver',
      ...buildCabPayload(cab),
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message ?? data.error?.message ?? 'Failed to create driver');
  }
  return data;
}

/** Update cab only via PATCH /api/drivers/:id/cab-identifier */
export async function updateDriverCabIdentifier(
  token: string,
  driverId: string,
  cab: CabIdentifierValue
) {
  const trimmed = cab.cabValue.trim();
  if (!trimmed) {
    throw new Error('Cab number or licence is required');
  }

  const response = await fetch(`${API_BASE}/api/drivers/${driverId}/cab-identifier`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      fieldType: cab.cabFieldType,
      value: trimmed,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message ?? 'Failed to update cab identifier');
  }
  return data;
}

/** Full driver update — cab uses cabFieldType + cabValue; only selected column is updated */
export async function updateDriver(
  token: string,
  driverId: string,
  payload: Record<string, unknown> & { cab?: CabIdentifierValue }
) {
  const { cab, ...rest } = payload;
  const body: Record<string, unknown> = { ...rest };

  if (cab?.cabValue.trim()) {
    body.cabFieldType = cab.cabFieldType;
    body.cabValue = cab.cabValue.trim();
  }

  const response = await fetch(`${API_BASE}/api/drivers/${driverId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message ?? 'Failed to update driver');
  }
  return data;
}

/**
 * Example: initialize edit form from existing driver row
 */
export function cabIdentifierFromDriver(driver: {
  cabNumber?: string | null;
  cabLicence?: string | null;
}): CabIdentifierValue {
  if (driver.cabLicence) {
    return { cabFieldType: 'cab_licence', cabValue: driver.cabLicence };
  }
  return { cabFieldType: 'cab_number', cabValue: driver.cabNumber ?? '' };
}
