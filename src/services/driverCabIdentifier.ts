import { queryClient } from '../db/connection';
import { CabFieldType, isCabFieldType } from '../utils/cabIdentifier';

export interface DriverCabIdentifierRow {
  id: string;
  cab_number: string | null;
  cab_licence: string | null;
  updated_at: Date;
}

/**
 * Update only cab_number OR cab_licence using parameterized SQL.
 * The non-selected column is left unchanged.
 */
export async function updateDriverCabIdentifier(
  driverId: string,
  fieldType: CabFieldType,
  value: string
): Promise<DriverCabIdentifierRow | null> {
  if (!isCabFieldType(fieldType)) {
    throw new Error('Invalid cab field type');
  }

  const trimmedValue = value.trim();
  if (!trimmedValue) {
    throw new Error('Cab value is required');
  }
  if (trimmedValue.length > 100) {
    throw new Error('Cab value must be 100 characters or less');
  }

  let rows: DriverCabIdentifierRow[];

  if (fieldType === 'cab_number') {
    rows = await queryClient<DriverCabIdentifierRow[]>`
      UPDATE drivers
      SET cab_number = ${trimmedValue}, updated_at = NOW()
      WHERE id = ${driverId}
      RETURNING id, cab_number, cab_licence, updated_at
    `;
  } else {
    rows = await queryClient<DriverCabIdentifierRow[]>`
      UPDATE drivers
      SET cab_licence = ${trimmedValue}, updated_at = NOW()
      WHERE id = ${driverId}
      RETURNING id, cab_number, cab_licence, updated_at
    `;
  }

  return rows[0] ?? null;
}
